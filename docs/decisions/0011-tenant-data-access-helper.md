# ADR 0011: Tenant data access helper, enforced by static tests and the cross-tenant harness

- Status: accepted
- Date: 2026-11-05

## Context

Every business table carries `organizationId`, and the database does not stop a query that forgets to
filter by it ([ADR 0006](0006-tenant-integrity-in-application.md)). One forgotten `where` in a controller
or service leaks another tenant's rows (BL03). Sequelize has no client extension that adds the filter
for us, so isolation has to be built explicitly, and it has to be hard to go around.

## Decision

- **One door.** `helpers/tenantScope.js` exports `tenant(ctx)`. `tenant(ctx).<Model>` offers exactly seven
  methods: `findAll`, `findOne`, `findByPk`, `count`, `create`, `bulkCreate` and `update`. There is no
  `destroy` and no raw query, so nothing on this door can skip the filter (business data is archived,
  not deleted). A method is added only by a story that needs it, with a test. `bulkCreate` was added for
  the transfer (two movements per item in one statement); like `create` it writes `organizationId` from
  the context on every row, after the row's own values.
- **Which models.** Every model that has an `organizationId` attribute is offered, detected at load time.
  `Plan` and `WebhookEvent` (global) and `Organization` (the tenant itself) are not offered.
- **The filter cannot be replaced.** The caller's `where` is combined with `{ organizationId }` by
  `Op.and`, never merged by key. A caller that filters on another organization, or uses `Op.or`, still
  gets only its own rows.
- **Writes.** `create` writes `organizationId` after the caller's values, so an input value is ignored.
  `update` removes `organizationId` from the values and scopes its `where`, so a row can neither be
  moved to another organization nor be touched when it belongs to another one (0 rows changed).
- **No organization, no wrapper.** `tenant(ctx)` throws when `ctx.organizationId` is empty (a Platform
  admin). That is a programming error: authorization must have answered 403 before.
- **Static test.** `__tests__/noDirectModelImport.test.js` fails when a file in `controllers/` or
  `services/` imports a model (`require("../models...")`). The written exception list is empty; an entry
  needs a file and a reason (for example a service that needs `sequelize.transaction`).
  `__tests__/noOrganizationIdFromRequest.test.js` fails when code reads `organizationId` from the request.
- **Cross-tenant harness.** E2-08 tries every endpoint with the other organization's ID and compares the
  routes of the app with its registry. That covers what a unit-level wrapper cannot see.

## Alternatives considered

- **`defaultScope` or `Model.scope()`:** the model definition does not know the request, and a scope can
  be removed with `unscoped()`.
- **Global Sequelize hooks (`beforeFind`):** carrying the context into a hook is awkward, and bulk
  updates and raw queries pass around them.
- **Repository classes with an explicit `organizationId` argument:** the argument is exactly what a
  developer forgets. More code for the same risk.
- **Postgres Row-Level Security now:** stronger, but it needs a session variable on every pooled
  connection. It stays the planned second layer (M3, E13-11).
- **Throwing when the input contains another `organizationId`:** surfaces a caller bug, but the
  acceptance criterion is to ignore it, and input validation already rejects unknown keys.

## Consequences

- Controllers and services cannot hold a model (static test); the helpers that do (`userAccess.js`, the
  ownership helper) are small and listed in review.
- `include` is not scoped: a join to a table can reach rows of another organization. A query that needs
  `include` must be reviewed, and the harness must cover its endpoint.
- Foreign keys written by a service (`warehouseId` from a body) are not checked by this helper. The
  ownership helper (E2-05) looks them up first.
- Code that needs `sequelize.transaction` needs a model import. When the first such service appears it
  gets a documented exception (or a small transaction helper); that decision is made in its story.
- Revisit when Row-Level Security lands.
