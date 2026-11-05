# ADR 0013: Warehouse row lock as the serialization point for stock writes

- Status: accepted
- Date: 2026-11-05

## Context

A stock write (receive now; adjust, transfer and import commit later) must not interleave with archiving the warehouse:
BL08 says an archived warehouse holds no stock. Archiving checks "no stock above 0" and then writes `archivedAt`; a receipt
that commits between the two leaves an archived warehouse with stock. The receipt, for its part, must read `archivedAt` and
the stock only after nothing else can change them. The `StockLevel` row of a (warehouse, product) pair may be created and
increased by two requests at once, and neither may lose an update. The assignment of members to a warehouse (BL10) has the
same problem with an archive: it must not assign users to a warehouse that was archived a moment before.

## Decision

- **`services/warehouseLock.js`: `lockWarehouse(ctx, warehouseId, transaction)`** reads the warehouse row of the caller's
  organization with `SELECT ... FOR UPDATE` (`lock: transaction.LOCK.UPDATE`) through the tenant data access. The lock lasts
  until the transaction commits or rolls back. It returns the row as it is once the lock is granted, or `null` for a missing
  or foreign warehouse. Calling it without a transaction is a programming error (the lock would be released at once).
- **Order of every stock write (rule 7):** take the warehouse lock first, then read `archivedAt` of the warehouse and the
  product, then change the stock and write the movement, all in the one transaction that `idempotencyService.run` opens
  (ADR 0012). A receipt adds to the `StockLevel` row with a read followed by a write: this is safe because the lock is held,
  so nobody else touches the row in between.
- **Archive and restore of a warehouse take the same lock** (`warehouseService.updateWarehouse`): `findOwned` answers first
  without a lock (a malformed, foreign or missing ID is a 404 and never waits), then one transaction locks the row, reads it
  again, checks that no stock row is above 0 and writes `archivedAt`. Whoever takes the lock first wins; the other sees the
  result (receipt: 409 for an archived warehouse; archive: 409 for a warehouse with stock). `replaceMembers` (the assignment)
  already took the same lock, so an assignment queued behind an archive finds the warehouse archived and answers 404.
- **Column limit.** The new quantity is compared with 2,147,483,647 in the service before writing, and above it the answer is
  409 with an Indonesian message, so the database never raises a numeric-overflow error.
- **FOR UPDATE and not FOR NO KEY UPDATE.** Both queue writers against each other. NO KEY UPDATE would also let another
  transaction insert a row that merely references the warehouse (a foreign-key check only takes KEY SHARE); FOR UPDATE makes
  that insert wait. The stricter mode costs nothing measurable here and is the one the assignment code and the docs already
  use. An ordinary `UPDATE` of the warehouse row (the archive) takes NO KEY UPDATE implicitly, so it waits for a holder of
  either mode.
- **Later stock writes use the same helper.** A write that touches two warehouses (transfer, E5) locks them one after the
  other in ascending ID order, so two opposite transfers cannot deadlock (ADR 0014).
- **Static test** (`__tests__/stockWritesLockWarehouse.test.js`): every file in `services/` that reaches `StockLevel` or
  `StockMovement` and calls `create`, `update`, `destroy`, `upsert`, `bulkCreate`, `increment` or `decrement` must contain
  `lockWarehouse(`. A real exception is listed in the test with a reason (empty at the start).

## Alternatives considered

- **Advisory locks (`pg_advisory_xact_lock`) per warehouse.** The same effect, but a second mechanism with its own key
  space, and the row lock is already tied to the transaction and to a row that exists.
- **`SERIALIZABLE` isolation.** Correct without a lock, but it fails with serialization errors that every caller must retry,
  and it affects every query of the transaction. Rejected.
- **Only an atomic `quantity = quantity + n`, no warehouse lock.** Safe for the quantity, but it does not stop a receipt
  from landing in a warehouse that is being archived at the same moment. Rejected.
- **Optimistic locking with a version column.** Needs a retry loop in every writer and still leaves the check-then-archive
  window open without extra care. Rejected.
- **`INSERT ... ON CONFLICT DO UPDATE` for the stock row.** Needs raw SQL outside the tenant data access (rule 3). With the
  lock held, the plain read-then-write is enough.

## Consequences

- Stock writes into one warehouse run one after another; different warehouses stay parallel. At the expected scale this is
  acceptable. A waiting writer holds one pooled connection (ADR 0012): the pool of `config/config.js` is sized for it and a
  request that cannot get a connection fails after 10 s.
- A request that finds the warehouse archived when it starts gets 403 from the controller (`ctx.warehouseIds` has no archived
  warehouse); 409 for an archived warehouse appears only for the race.
- The lock is on the warehouse row, so it also serializes a stock write against a rename of that warehouse. This is harmless
  (renames are rare and short) and noted so nobody is surprised.
- The static test reads source text. A lock taken in a helper file needs that file to be listed as an exception, or the call
  kept next to the write. The check is coarse: a service that only touches stock rows and updates something else is also
  asked to lock, which is the safe direction.
- Concurrency tests (`warehouseArchive.lock.test.js`) hold the lock in an open transaction and prove that a second request
  waits; races with an unknown order assert an invariant (an archived warehouse never holds stock) instead of an order.
