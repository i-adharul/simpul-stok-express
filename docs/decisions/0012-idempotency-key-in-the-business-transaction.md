# ADR 0012: Idempotency by a key row written in the same transaction as the business effect

- Status: accepted
- Date: 2026-11-05

## Context

A client that retries a stock write (receive, adjust, transfer, import commit) after a timeout must not
change stock twice (BL14). The database is the only source of truth: no cache, no Redis
([docs/05](../05_Technical_Design.md)). The table `IdempotencyKeys` already exists with a unique constraint on
`(organizationId, key, endpoint)` and an index on `createdAt` (ADR 0003). Its `resourceId` is nullable and has no foreign key,
because it points to a `StockMovement`, a `StockTransfer` or an `ImportJob` depending on `endpoint`. Story E4-01 needs one
helper that every stock write endpoint uses.

## Decision

- **`middlewares/idempotencyKey.js`** reads the `Idempotency-Key` header, requires a UUID and stores it in lower case in
  `req.idempotencyKey`. A missing or malformed value is a 400 `VALIDATION_ERROR` with
  `details: [{ source: "header", path: "Idempotency-Key", message }]`. On a route it sits after `authentication`, the role check
  and `subscriptionGuard`, and before `validate`.
- **`services/idempotencyService.run(ctx, { key, endpoint }, { work, load, access })`** resolves to `{ replayed, body }`.
  - **Order of a request.** (1) The controller authorizes the user (role and warehouse) with `can`. (2) `run` looks the key up
    through `tenant(ctx).IdempotencyKey` (pre-check); a hit goes to step 5. (3) Otherwise one `sequelize.transaction` runs
    `work(transaction)`, which returns the ID of the created resource, and then inserts the key row as its LAST statement
    (its `resourceId` is only known after `work`; no migration is needed). (4) If the transaction fails for ANY reason and the
    key exists now, a twin finished first, so go to step 5; if it does not exist, the original error is thrown unchanged.
    (5) The response body is built by `load(resourceId)` for the first call and for a replay alike, so the two cannot differ.
    The controller sends 201 and, for a replay, the header `Idempotency-Replayed: true`. The body of the repeated request is
    not compared.
- **Authorize before the pre-check.** The pre-check answers from the table. If it ran first, a user who may not act (a Viewer)
  could be shown a replay. The controller therefore authorizes first, and a replay is authorized again against the LOADED
  resource through `access(ctx, body)`: a user who may not see it, or a resource that cannot be loaded, gets the same 404
  `NOT_FOUND` as a missing resource (rule 2), never 403, so a key of another warehouse reveals nothing.
- **Race analysis.** Two requests with the same key both pass the pre-check and both run `work`. The first inserts the key and
  commits. The second blocks on the unique constraint at its own key insert and fails with a unique-constraint error after that
  commit; its transaction, including `work`, rolls back. Only one effect survives. The warehouse row lock taken by stock
  writes (ADR 0013) makes the second request wait for the first even earlier.
- **Why the re-check covers every error, not only the unique violation.** `work` of the second request runs on top of the first
  one's committed data. It can fail on its business rule first (for example `INSUFFICIENT_STOCK` after the first request used
  the last units) and never reach the key insert. Looking at the table after any failure turns that into a replay. A genuine
  error, with no key stored, is not hidden. A failing lookup is ignored so the original error is the one reported.
- **Pool and timeouts.** Sequelize 6 has no per-transaction timeout option, and a transaction holds one pooled connection from
  `BEGIN` to `COMMIT`. `config/config.js` sets the pool explicitly: `max: 10`, `acquire: 10000` (ms). A request that cannot get a
  connection fails after 10 s instead of hanging for the default minute. Rule for `work`: every query inside takes
  `{ transaction }`, otherwise it asks for a second connection while holding the first and can starve the pool under
  parallel load. A database-side `statement_timeout` is a deployment setting (E6-04), not part of this decision.
- **Registry guard.** A registry entry sets `idempotent: true`; the harness (E2-08) then proves a write without a valid key gets
  400 and that the same valid request twice gives one effect, an identical body and `Idempotency-Replayed: true` on the second
  answer only. Every stock write endpoint must set it.

## Alternatives considered

- **Key row first with a nullable `resourceId`.** Leaves a row without a resource if the process dies between the statements,
  and a retry would be answered as "done" for work that never happened.
- **A status column (`PROCESSING` / `DONE`) and a reservation before the work.** Closes the parallel-work window but needs a
  migration, a rule for stuck reservations and a polling client. Not needed at this scale.
- **Catching only the unique violation.** Misses the business-error race above.
- **Advisory locks per key.** A new mechanism; the unique constraint already serializes the winner.
- **Redis or an in-memory cache.** Rejected in the PRD: the unique key already guarantees it.
- **Storing the response body in the key row.** Needs a column, and a replay could show data the caller may no longer see.
- **Comparing the request body and answering 422 on a mismatch.** BL14 says the body is not compared.

## Consequences

- No migration. `createdAt` is already indexed for the cleanup.
- In a race, `work` runs twice and one run is rolled back. This is wasted work, not a wrong result.
- **Known limitation:** two parallel requests with the SAME key but DIFFERENT bodies give the first one's result to both. This
  is client misuse (a key identifies one intent) and is accepted.
- A replay shows the CURRENT state of the resource, not a snapshot. For an immutable `StockMovement` this is the same thing.
- A request that failed leaves no key, so its retry runs again, which is what the client wants.
- The 24-hour cleanup of old keys (BL24) is the cron of E10-04 and is not part of this decision. Until it runs, a key stays valid
  for longer than 24 hours.
- An endpoint that calls `run` without authorizing first is a coding mistake. The handler convention is: `can(...)`, then `run`.
  The cross-tenant harness catches a role without permission that still gets a result.
- A caller who sends no key to a stock write and may not act gets 403 (the role check comes first). A caller who may act and
  sends no key gets 400 before the body is validated. Nothing about any resource is revealed.
