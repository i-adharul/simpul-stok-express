# ADR 0006: Tenant integrity enforced by the application, not composite foreign keys

- Status: accepted
- Date: 2026-11-05

## Context

Tables such as `StockLevels`, `StockMovements` and `UserWarehouses` carry their own `organizationId`
and also point to a warehouse and a product. A plain foreign key on `warehouseId` only proves that the
warehouse exists. It does not prove that the warehouse belongs to the same organization as the row, so
a row that mixes two tenants is possible at the database level. The tenant isolation rules in
`docs/03_Data_Model.md` are all enforced above the database.

## Decision

Story E0-05 uses plain single-column foreign keys (`ON DELETE RESTRICT`, see ADR 0003). Tenant
consistency is the job of the application:

- every query on tenant data goes through `helpers/tenantScope.js` and `helpers/ownership.js`, which add
  the `organizationId` filter (E2-04);
- an ID of another organization answers 404, so a service looks a warehouse or product up through that
  helper before it writes a row that points to it;
- the `organizationId` of a new row always comes from `req.ctx`, never from the request;
- the cross-tenant test harness (E2) tries to reach and to write other tenants' data through every
  endpoint, and a test fails when a route is missing from the registry;
- Postgres Row-Level Security is the planned second layer if time allows.

## Alternatives considered

- **Composite foreign keys `(organizationId, id)`:** the database would refuse a mixed row. It needs an
  extra unique constraint on every parent table (`Warehouses`, `Products`, `Users`, `StockTransfers`),
  larger indexes and more verbose migrations, and every table needs it for the guarantee to be complete.
- **Row-Level Security now:** a strong second layer, but it needs a session variable set on every
  connection, which works poorly with pooled connections (Supabase pooler). It is a larger piece of work
  of its own.
- **Triggers that compare `organizationId` across tables:** extra logic per table that is easy to forget
  and hard to read.

## Consequences

- A row that points to a warehouse or product of another tenant can technically be created by raw SQL
  or by an application bug. Nothing in the schema stops it.
- The guarantee depends on the tenant data helpers and their tests. A controller or service that imports
  a model directly bypasses it, so the static test that forbids this (rule 3) is part of the defence.
- Migrations and indexes stay simple and small.
- Revisit this decision when Row-Level Security lands, or if a cross-tenant test finds a leak.
