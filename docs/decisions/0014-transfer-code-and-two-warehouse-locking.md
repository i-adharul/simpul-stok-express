# ADR 0014: Transfer code without a shared row, and two-warehouse locking for transfers

- Status: accepted
- Date: 2026-11-05

## Context

A transfer gets a code `MT-0001`, sequential per organization (functional spec, Design decisions: Document numbers).
The spec forbids a design where all transfers of an organization queue on one row. A transfer also writes stock in two
warehouses at once, so it must not deadlock with an opposite transfer (BL13), and tenant data is reached only through
`helpers/tenantScope.js` (rule 3). The unique index `(organizationId, code)` already exists on `StockTransfers`, so no
migration is needed.

## Decision

- **Locking.** `transferService.transfer` runs inside `idempotencyService.run` (ADR 0012) and takes `lockWarehouse`
  (ADR 0013) for both warehouses in ascending ID order (IDs compared in lower case), one after the other, before it reads
  `archivedAt`, the products or any stock. Two transfers that share a warehouse wait for each other in the same order and
  cannot deadlock, whatever the direction. While both locks are held no other stock write touches either warehouse. The
  order inside the transaction is still deterministic: items sorted by `productId`, all source decrements first (so a
  shortage fails before the destination is touched), then the destination rows and increments. Rule 6 ("ordered by
  warehouse, product") is met by the lock order plus this item order.
- **Decrement.** One conditional UPDATE per item, `quantity = quantity - n WHERE quantity >= n`; an affected-row count of
  0 is `409 INSUFFICIENT_STOCK` with `details.productId` of the first item (by product ID) the source cannot cover. The
  throw rolls back the decrements already made.
- **Code.** Inside the transaction: the `count` of the organization's transfers plus one, padded to four digits
  (`MT-0001`; a fifth digit appears after `MT-9999`). Transfers are never deleted (rule 10) and a rolled back transaction
  consumes nothing, so codes have no gaps.
- **Collision.** Two transfers on different warehouses can read the same count. The second insert waits on the unique
  index and fails when the first commits. Only the insert of the transfer row sits inside a SAVEPOINT
  (`helpers/transaction.js: inSavepoint`, a Sequelize nested transaction): a break of
  `StockTransfers_organizationId_code_key` rolls back to the savepoint, and the insert is repeated with a fresh count, up
  to 5 times, after a random pause of at most 30 ms (so at most 6 attempts). The locks and the stock changes already made
  in the transaction survive. After the retries the answer is `409 CONFLICT` ("Terlalu banyak mutasi bersamaan, coba
  lagi."). Any other error, including a clash of the idempotency key, is not a collision and is thrown unchanged.
- **Movements.** All movements of a transfer are written with one `bulkCreate` (two rows per item, same `transferId`),
  and the missing destination rows with one `bulkCreate` (`ignoreDuplicates`), to keep the time both locks are held short.
  `bulkCreate` was added to the tenant data access for this (ADR 0011 lists it): every row gets `organizationId` from the
  context.
- The response is built from the stored rows (id, code, warehouses, items from the `TRANSFER_OUT` movements, note,
  createdAt), never from stock balances, so a replay equals the first answer.

## Alternatives considered

- **A counter row per organization, incremented per transfer.** Gap-free and simple, but every transfer of an
  organization would queue on that row, which the spec forbids. Rejected.
- **A Postgres advisory lock per organization.** The same serialization, in a second mechanism, and raw SQL. Rejected.
- **Locking a fixed row (for example the organization) while numbering.** Serializes unrelated work, including transfers
  between different warehouses. Rejected.
- **A database sequence or a random code.** A sequence is global and leaves gaps after a rollback; a random code is not
  sequential. Rejected.
- **Repeating the whole transaction on a collision.** Needs a new transaction with new locks for every attempt and cuts
  across `idempotencyService.run`, which opens the transaction. The savepoint keeps the repair local to one INSERT.
- **`INSERT ... ON CONFLICT DO NOTHING` and reading the row back.** Raw SQL outside the tenant data access (rule 3).

## Consequences

- Transfers that touch one warehouse run one after another, as every stock write already does (ADR 0013). Transfers on
  disjoint warehouses stay parallel but may retry on a code collision; a busy organization can see the 409 above when
  six attempts in a row collide.
- The code depends on transfers never being deleted. Deleting one would reuse its number.
- The retry path is tested without a hook in production code: a test inserts one transfer coded `MT-0002`, so the count
  is 1 and the next code `MT-0002` collides on every attempt, until the 409 above is returned with nothing changed.
- A transfer holds two warehouse locks until it commits, and a waiting writer holds one pooled connection (ADR 0013).
- The stock row lock taken by the first decrement already queues transfers of the same product. The warehouse locks are
  what queue transfers of different products (code collisions) and what keep opposite transfers from deadlocking; the
  tests of both effects are in `transfer.service.proof.test.js` and `transferService.lock.test.js`.
