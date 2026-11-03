# ADR 0002: A flat structure, with services only for risky logic

- Status: proposed
- Date: 2026-11-03

## Context

The API needs a folder layout that one person can keep in their head. Common Express
practice is flat: `routes/`, `controllers/`, `models/`, `middlewares/`, `helpers/`.

Most endpoints in this project are plain CRUD (warehouses, products). A few are not: login
and sessions, stock changes, transfers and idempotency. These carry the project's claims
(no negative stock, atomic transfers, no repeated effects), so their logic must be easy to
find, read and test without going through HTTP.

## Decision

Keep the folders flat under `server/`, with one addition: a `services/` layer used only for
risky logic.

```
request -> routes -> middlewares -> controller -> service -> model -> database
```

- **Controllers** are thin: read the request, call a service or the tenant data access, reply.
  Simple CRUD controllers may call the tenant data access directly.
- **Services** hold the risky business logic and know nothing about `req` and `res`.
- **Tenant data access** (`helpers/tenantScope.js` and `helpers/ownership.js`) is the only
  door to the models for tenant data.

Stock services may call billing services, never the reverse. This is kept by convention and
by one static test.

Split into per-domain folders (`controllers/stock/`, `controllers/billing/`) only when one
folder holds more than about 12 to 15 files, imports become circular, or a new standalone
domain appears.

## Alternatives considered

- **Per-domain folders from the start (`modules/stock`, `modules/platform`):** this is how the
  sibling repository is organised. It adds folders before there are enough files to need
  them.
- **A service for every endpoint:** most services would only forward a call to the model.
  That adds files to read without adding any rule.
- **No service layer:** the cheapest, but the logic for stock changes and transfers would
  sit in controllers next to HTTP details, which makes it harder to test and to review.

## Consequences

- Few folders, and a new contributor can find a file by its role.
- The rule "risky logic goes in a service" needs judgement. When unsure, ask whether the
  code decides something that must never be wrong (money, stock, access); if so, it goes in a
  service.
- Splitting into per-domain folders later is a mechanical move, and the tests will catch
  broken imports.
- The one-way dependency between stock and billing is not enforced by the folder layout, so
  the static test must stay in place.
