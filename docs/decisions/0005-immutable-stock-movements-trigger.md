# ADR 0005: Immutable stock movements enforced by a database trigger

- Status: accepted
- Date: 2026-11-05

## Context

`StockMovements` is the history of every stock change. `StockLevels.quantity` is only a running
balance; the movements are what explains it. If a movement can be edited or removed, the balance can no
longer be explained by its history and the audit trail loses its value. `docs/03_Data_Model.md` calls
the table append-only, and the project rules say movement rows are immutable. The table is created in
story E0-05, so this is the moment to decide who enforces the rule.

## Decision

A row-level trigger `StockMovements_append_only_trg` (`BEFORE UPDATE OR DELETE`, `FOR EACH ROW`) calls
the function `prevent_row_change()`. The function raises an exception with the SQLSTATE
`restrict_violation` (23001) and the message `StockMovements rows are append-only: UPDATE is not
allowed` (or `DELETE`). Both live in a raw SQL migration. The function reads `TG_TABLE_NAME`, so
the `AuditLog` table (E0-06) reuses it with its own trigger.

`TRUNCATE` is not blocked. In PostgreSQL it is a separate statement-level event, and the test
suite uses it to empty the table between cases. That is deliberate and limited to people with the
`TRUNCATE` privilege.

`server/__tests__/schema/stockMovement.test.js` proves that UPDATE and DELETE are refused, that the row
is unchanged afterwards, and that inserting still works.

## Alternatives considered

- **Application rule only (no function updates or deletes a movement):** costs nothing, but a seed
  script, a raw SQL statement, a manual fix or a future bug can still change a row. The database is the
  last line, as with `CHECK (quantity >= 0)`.
- **`REVOKE UPDATE, DELETE` from the application role:** also strong, but it needs a separate database
  role per environment (local, test, Supabase) and migrations would have to run as another role. It does
  not protect against the table owner either.
- **A trigger that also blocks `TRUNCATE`:** would stop test cleanup, and the tests would need another
  way to reset data.
- **Soft "voided" flag on the row:** needs an UPDATE, which is exactly what must not happen. A
  correction is a new row (for example an `ADJUST` movement).

## Consequences

- Any code path that tries to change a movement gets an error, so a correction is always a new row,
  never an edit.
- A superuser or the table owner can still disable the trigger (`ALTER TABLE ... DISABLE TRIGGER`) or
  truncate the table. This protects against mistakes, not against someone with full database rights.
- If the error ever reaches the error handler it signals a bug, not a user mistake, so it must become a
  generic 500 and never a business error.
- Deleting an organization, warehouse or product is already blocked by `ON DELETE RESTRICT`, so no
  cascade can reach the trigger.
- The trigger exists only in a migration (like the other rules in ADR 0003), so it is not visible in the
  Sequelize model.
