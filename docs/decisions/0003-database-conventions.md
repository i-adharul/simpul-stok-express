# ADR 0003: Database conventions (IDs, names, times, deletes, rules in SQL)

- Status: accepted
- Date: 2026-11-04

## Context

Story E0-04 creates the first four tables (Organization, User, Plan, Subscription). Every later
table repeats the choices made here, so they are recorded once. Constraints that shaped them:

- The application is multi-tenant. A guessed ID that belongs to another organization must return
  404, and the tenant filter is the real defence (`docs/03_Data_Model.md`, tenant isolation rules).
- Business data is archived, not deleted. Dates are stored in UTC.
- Some rules must hold no matter which code path writes the row: the application, a seed script, a
  test, or a manual SQL statement.

## Decision

- **IDs are UUID v4, created by the database** with `DEFAULT gen_random_uuid()`, which is built into
  PostgreSQL since version 13 and needs no extension. The model also declares `UUIDV4` as its
  default so that Sequelize can build an object before it is saved.
- **Names follow the Sequelize defaults and `docs/03_Data_Model.md`.** Tables are plural PascalCase
  (`Organizations`) and columns are camelCase (`organizationId`). Hand-written SQL quotes them.
  Migrations spell the table name out (`tableName`) instead of relying on pluralization.
- **Time.** Every date column is `timestamptz` (Sequelize `DATE` on PostgreSQL), so it stores an
  instant in UTC. `createdAt` and `updatedAt` have `DEFAULT now()` in the database, so a raw INSERT
  does not fail on NOT NULL. Sequelize still sets `updatedAt` on every model update.
- **Deletes.** Every foreign key is `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`, written explicitly.
  Rows are archived, never deleted, so deleting a parent that still has children must fail instead of
  cascading. The referencing column of a foreign key gets an index, because PostgreSQL does not
  create one.
- **Enums** are PostgreSQL ENUM types created by Sequelize (`enum_Users_role`). The `down` of a
  migration drops the type explicitly, because `dropTable` leaves it behind and a second `db:migrate`
  would fail.
- **Rules kept by the database.** Each rule is a named constraint, `<Table>_<column>_<kind>` (for
  example `Organizations_slug_check`), added with raw SQL in the migration: slug format, lowercase
  email, a platform admin if and only if `organizationId` is empty, the two reset columns filled
  together, billing day between 1 and 31, period order, and positive plan limits. The names let the
  tests and the API error mapping tell which rule was broken. One test file per table in
  `server/__tests__/schema/` proves each constraint against the test database.
- **Applied migrations are not edited.** A change to an applied migration is a new migration.
- **The test database is migrated automatically** by a Jest `globalSetup` that first checks the
  database name ends in `_test`.
- **Application rules stay in the application:** one Owner per organization (BL07) and the
  Subscription status (stored in `Organization.status`).

## Alternatives considered

- **Integer auto-increment IDs:** easy to guess and enumerate, and they reveal how many rows exist.
  The tenant filter would still return 404, but one layer of defence is lost.
- **UUID v7:** ordered by time, so inserts are friendlier to the index. `uuidv7()` exists only from
  PostgreSQL 18, and the local database runs an older version.
- **UUID generated only in JavaScript:** a seed or a manual INSERT would get no ID.
- **snake_case names with `underscored: true`:** nicer in SQL, but it differs from the documents and
  needs a mapping on every model and every raw query.
- **`CASCADE` or `SET NULL` on delete:** both break the "archive, never delete" rule. `SET NULL` on
  `Users.organizationId` would silently turn a tenant user into a platform admin.
- **Keeping these rules in the application only:** a seed, a test or a bug can write bad rows. The
  database is the last line, as with `CHECK (quantity >= 0)` on stock.
- **`STRING` with a CHECK instead of ENUM:** simpler to change, but the enum type documents the
  allowed values in the schema itself.

## Consequences

- Raw SQL must quote names (`"organizationId"`), which is easy to forget.
- A new enum value needs a migration with `ALTER TYPE ... ADD VALUE`. A value cannot be removed or
  reordered without recreating the type.
- Database errors for these rules (for example a duplicate email) must be mapped to API errors by
  constraint name in the service layer. Sequelize reports a unique violation as a generic
  "Validation error"; the constraint name is on `error.parent.constraint`.
- A later move to UUID v7 is possible once the database version allows it, as a new migration.
- Sequelize `sync()` is never used; the schema comes only from migrations.
