# Technical Design: Simpul Stok (Express version)

|          |                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Version  | 1.0 (3 Nov 2026)                                                                                                                 |
| Purpose  | The technology choices, the code structure, and the architecture and security decisions of the Express + Sequelize version, with the reasons and the alternatives that were rejected |
| Audience | People who build and review the system                                                                                           |
| Related  | Decisions that need a longer note are written as decision records in [`decisions/`](decisions/)                                  |

## Why there is an Express version

The product, the scope, the business rules (BL), the data model, and the claims the project proves are **the same** as in the sibling implementation built with Next.js, TypeScript and Prisma. Only the tooling differs. The core ideas (transactions, row locks, conditional atomic updates, idempotency, tenant isolation) do not depend on an ORM or a framework, and building them with a different stack shows that.

## Tech stack and why

Selection principles: (1) one person can explain all of it, (2) it is widely used in the industry, (3) it does not hide what the project wants to prove, (4) the folder structure stays close to common Express practice.

| Layer | Chosen | Why | Why not the others |
| --- | --- | --- | --- |
| Language | JavaScript (Node.js, CommonJS) | Keeps the focus on the concepts, not on the syntax | **TypeScript:** weak Sequelize support and extra weight that does not add to the claims being proved |
| API framework | Express 5 | The flow reads top to bottom; errors from async functions reach the error handler automatically | **NestJS:** adds layers (decorators, dependency injection) that hide the flow |
| Database | PostgreSQL | ACID transactions, `CHECK` constraints, triggers, indexes, `SELECT ... FOR UPDATE` | MongoDB: the data is relational and needs transactions across tables |
| Database hosting | Local Postgres for development and tests; Supabase (managed Postgres) for the demo and production | The skills transfer; tests need no internet. Supabase is used only as plain Postgres | **Neon:** equivalent, may be swapped. Supabase auth and RLS features are not used |
| ORM | Sequelize 6 with `sequelize-cli` | Migrations and seeders come with the tool | **Prisma:** used in the sibling repository. A different ORM here shows the concepts are not tied to one |
| Validation | Zod | One schema per endpoint, structured errors, works in JavaScript | **Joi / express-validator:** also valid |
| Auth | JWT bearer in the `Authorization` header, `bcryptjs`, `jsonwebtoken` | The client (Vercel) and the API (EC2) are on different domains, so cross-domain cookies would be awkward | **`httpOnly` cookie:** safer against XSS but needs a shared domain, HTTPS and CSRF protection. Noted as a later improvement |
| Token storage | `localStorage` in the browser | Simple, survives a refresh | The XSS risk is accepted and mitigated (see Security) |
| Client | React 19, Vite, Tailwind, daisyUI, axios, react-router | Small and common | Next.js: used in the sibling repository |
| Client state | Local React state and one `AuthContext` | Most data comes from the server | **Redux:** too heavy for about ten screens |
| Payments (M2) | Xendit Invoice (sandbox) | A local gateway; webhooks are easy to test | Midtrans is also fine; pick one |
| Scheduling (M2) | `crontab` on the server calls `GET /api/cron/daily` with a secret | No extra dependency; the access status is computed per request, so a failed cron job never opens access | `node-cron`: works, but stops when the process stops |
| Import and export (M3) | `papaparse` (CSV), `exceljs` (XLSX), `pdfkit` (PDF) | Run in Node without system dependencies | Puppeteer: heavy |
| Tests | Jest 30 and Supertest, real Postgres, `--runInBand` | Race conditions and tenant isolation are proven only against a real database; the test files share one database, so they run one by one | Mocking Sequelize: proves nothing about locks and transactions |
| API documentation | `api_doc.md` and one `.http` file per resource | Easy to run from VS Code and to demonstrate | OpenAPI: postponed |
| Code quality | Prettier optional; **no CI** in this version | Tests run locally with `npm test`; the README says how | GitHub Actions CI: can be added later |
| Environment | No Docker; Postgres installed directly and managed with DBeaver | Fewer things to learn | Docker Compose: optional |
| Deploy | **Live since the end of M1.** API on one EC2 instance (Node under `pm2`, Nginx as the TLS terminator, HTTPS with Let's Encrypt) at `simpulstok-api.adharul.my.id`; client on Vercel at `simpulstok.adharul.my.id`; database on Supabase through the session pooler with verified TLS (ADR 0007, ADR 0008) | Shows an understanding of basic infrastructure | A managed platform for the API: faster but hides what the project wants to show |

Redis is not used (idempotency is guaranteed by a unique key in the database). Email is not used (invitation and reset links are copied by hand).

**Verify before building (external facts):** the free-tier limits of Supabase (a free project can be paused), which connection mode is safe for transactions and row locks (use a direct or session-mode connection, not a transaction-mode pooler), the validity period of Xendit invoices, and the format of Xendit webhook payloads. Check the official documentation before working on the related part.

## Code structure

The structure is flat, as in common Express practice, with one addition: a `services/` layer only for risky logic.

```
simpul-stok-express/
├── server/
│   ├── bin/www.js
│   ├── app.js
│   ├── config/            config.js (sequelize-cli, reads env), env.js (validated `env` object, parses process.env once), envSchema.js (Zod schema and pure parseEnv)
│   ├── migrations/  models/  seeders/
│   ├── routes/            index.js + one file per resource
│   ├── controllers/       thin: read the request, call a service or tenant data access, reply
│   ├── services/          auth, stock, transfer, idempotency (+ billing, planLimit in M2)
│   ├── schemas/           Zod schemas per resource
│   ├── middlewares/       authentication, authorization, validate, idempotencyKey,
│   │                      subscriptionGuard, requestLogger, errorHandler
│   ├── helpers/           bcrypt, jwt, errors (AppError), tenantScope, ownership,
│   │                      permissions, password, pagination, logger
│   ├── __tests__/         + support/ (DB reset, factories, endpoint registry)
│   └── .env  .env-template.txt  .sequelizerc  jest.config.js  package.json
├── client/                React + Vite (views, layouts, components, constants, utils, context)
├── docs/                  these documents and decisions/
├── api_doc.md  README.md  CLAUDE.md
```

**Request flow:**

```
request -> routes -> middlewares -> controller -> service -> model -> database
```

1. **Middlewares:** `requestLogger`, `authentication` (verifies the token, loads the user from the database, builds `req.ctx`), `validate(schema)`, `subscriptionGuard`, and `idempotencyKey` where needed.
2. **Controller:** receives `req.ctx` and the validated input, calls a service or the tenant data access, and replies. Simple CRUD controllers (warehouses, products) may use the tenant data access directly.
3. **Service:** the risky business logic (login and session, stock changes, transfers, idempotency). It knows nothing about `req` and `res`.
4. **Tenant data access** (`helpers/tenantScope.js`): the only door to the models for tenant data. It always adds the `organizationId` from `req.ctx`.

**Dependency direction.** Stock services may call billing services (for example to check a plan limit), never the other way round. In M1 there are no billing services, so this is kept by convention. A static test that enforces the direction is added together with the first billing service (E8).

**When the flat structure is split.** When one folder holds more than about 12 to 15 files, imports become circular, or a new standalone domain appears, move to per-domain subfolders (`controllers/stock/`, `controllers/billing/`). That is a mechanical refactor and the tests will catch broken imports.

## Architecture and security decisions

**1. Request context (`req.ctx`)**

The `authentication` middleware reads `Authorization: Bearer <token>`, verifies the signature and the expiry, and then **loads the user from the database on every request**. A deactivated user is therefore rejected at once, even if the token has not expired. A token is also refused when its `iat` is older than `passwordChangedAt` (compared in whole seconds). The result is `req.ctx = { userId, organizationId, role, warehouseIds }`. Every layer below receives only this context, and `organizationId` is **never** read from the body, the query or the URL.

**2. Tenant isolation without a Prisma extension**

Sequelize has no extension like Prisma's, so isolation is built explicitly and tested:

- `helpers/tenantScope.js`: `tenant(ctx).Warehouse.findAll(opts)` adds `organizationId` to `where`; `create` always sets `organizationId` from `ctx` and ignores any value from the input.
- `helpers/ownership.js`: `findOwned(ctx, Model, id)` throws 404 for an ID that does not exist **or** belongs to another organization (always 404, so existence does not leak). An ID that is not a UUID is also 404.
- **Static test** (Jest): files in `controllers/` and `services/` must not import models directly, except those on a short written list (for example looking a user up by email at login, when the tenant is not known yet). It replaces a lint rule.
- **Cross-tenant harness** (`__tests__/support/registry.js`): two organizations; every endpoint is tried with an ID of the other organization and must answer 404. Another test compares the routes of the Express router with the registry, so an endpoint that was forgotten makes the tests fail. See the Test Plan.
- Second layer (M3, E13-11): Postgres Row-Level Security.

**3. Stock changes without negative stock**

- Every change runs in one `sequelize.transaction`.
- Every stock write takes the **warehouse lock** first (`SELECT ... FOR UPDATE` on the `Warehouse` row through `lock: t.LOCK.UPDATE`). For a transfer, both warehouses are locked in the same ID order to avoid deadlocks.
- A decrement is a conditional atomic update: `UPDATE ... SET quantity = quantity - :n WHERE ... AND quantity >= :n`, followed by a check of the affected-row count. If it is 0, the stock is not enough and the transaction is cancelled (409).
- The database `CHECK (quantity >= 0)` is the last safety net.
- The `StockMovement` table cannot be changed or deleted: a trigger rejects `UPDATE` and `DELETE`.
- Postgres defaults to Read Committed. The warehouse lock makes stock writers queue, and the conditional update stays correct even if a lock is missed.

**4. Idempotency**

The header `Idempotency-Key` (a new UUID every time a form is opened). The table `IdempotencyKey` with a unique key `(organizationId, key, endpoint)` is the only source of truth. A repeated request with the same key returns the same result with no second effect and without comparing the body. Keys are removed after 24 hours (cron, M2).

**5. Payment webhook (M2)**

Verify the token before reading the body. Store a `WebhookEvent` with a unique key `(provider, eventId)`; if it exists already, answer 200 without processing again. The invoice and subscription update run in one transaction. The invoice status is fetched again from the gateway API before an account is activated (BL22).

**6. Basic security that must exist**

- `bcryptjs` with cost 12 (so a password is at most 72 characters). The JWT is valid for 8 hours with no extension. Tests hash passwords with cost 4 (Jest only); production uses 12.
- All input is validated with Zod on the server. A write route must declare a schema (kept by a static test).
- Secrets (`JWT_SECRET`, the database URL, the cron secret, the Xendit keys) live only in environment variables. `config/env.js` parses them with the Zod schema in `config/envSchema.js` and refuses to start if one is missing or invalid.
- **Security headers and CORS:** `helmet`, and CORS with a list of allowed origins from `CORS_ORIGIN` (no wildcard).
- **No CSRF protection**, because the browser does not send the token by itself (a bearer header). This follows from choosing bearer and must be explained honestly.
- **XSS trade-off:** a token in `localStorage` can be stolen if there is an XSS flaw. Mitigations: an 8-hour lifetime, user text rendered through plain React (no `dangerouslySetInnerHTML`), input validation, `helmet`, and the user being read from the database on every request. A later improvement is an `httpOnly` cookie on a shared domain or through a proxy, plus an Origin check.
- Login and sign-up rate limiting does not exist in this version (noted as a limitation in the README).
- Error messages never leak stack traces or the existence of another tenant's data. Login gives the same message for a wrong email and a wrong password.
- Structured JSON logs with a request ID; fields that look like secrets (`password`, `authorization`, `token`) are redacted, and request bodies are not logged.

## Complementary technical decisions

| Item | Why it matters | Decision |
| --- | --- | --- |
| Database configuration | `config.json` cannot read environment variables and could be committed by accident | `config/config.js` reads the environment; `.sequelizerc` points the CLI at it; the connection verifies the server certificate (`rejectUnauthorized: true`) against the CA file named by `DATABASE_CA_PATH`, which is required when `NODE_ENV=production` (ADR 0007) |
| Test database guard | Tests empty the tables | The Jest setup stops if the test database name does not end in `_test` |
| Seed guard | A seed with default passwords is dangerous in production | The seed refuses a non-local database unless `SEED_ALLOW_REMOTE=true`, and on a remote database it also needs a strong `SEED_PASSWORD` and refuses the public demo password (`helpers/seedGuard.js`, ADR 0007) |
| Time zone | Consistent data | Stored in UTC, shown in WIB in the client |
| Error format | The client needs one pattern | `{ code, message, details }`, no stack trace (BL29) |
| IDs | Easy in URLs, not guessable in sequence | UUID v4 |
| API documentation | A REST API must be demonstrable | `api_doc.md` and one `.http` file per resource |
| Backup and retention | Customer data | Supabase backups; business data is archived, not permanently deleted (except `IdempotencyKey`); the audit log and history are kept indefinitely |
| Deploy | Basic infrastructure that can be explained | Done in E6-04: EC2 with `pm2`, Nginx and HTTPS (`server/scripts/deploy.sh`); the client on Vercel with `VITE_API_URL` and `client/vercel.json`; CORS allows only the client domain; migrations run from a laptop, not in the deploy (ADR 0008) |

## Measured: the stock history query (BL16)

The history (`GET /api/stock/movements`) must stay fast with 10,000+ rows. It was measured on a local PostgreSQL with
24,000 `StockMovements` rows (12,000 in the measured organization, 12,000 in two others, 5 warehouses and 50 products each),
timestamps spread over 120 days, after `ANALYZE`. Query shape: `WHERE "organizationId" = ? AND "warehouseId" IN (...)`
`ORDER BY "createdAt" DESC, id ASC LIMIT 51`, with the index `(organizationId, createdAt DESC, id)`.

| Query                              | Plan                                                           | Execution time |
| ---------------------------------- | -------------------------------------------------------------- | -------------- |
| First page                         | Index Scan on the history index, stops after 51 rows           | 0.014 ms       |
| Page 5,000 rows in (keyset cursor) | Index Scan on the history index, 5,001 rows rejected by filter | 0.644 ms       |
| One warehouse                      | Index Scan Backward on `(organizationId, warehouseId, createdAt)` + incremental sort | 0.027 ms |
| One product                        | Bitmap scan on `(organizationId, productId, createdAt)` + top-N sort | 0.104 ms |
| Date range (last 7 days)           | Index Scan on the history index with the range as index condition | 0.016 ms   |

Reading the figures: every query uses an index that starts with `organizationId`. The cursor condition is an `OR` of two
comparisons, so it is applied as a filter, not as an index condition: the cost of a page grows with how deep it is (a scan over
the rows already passed). At 5,000 rows deep this is still under 1 ms. A deeper history would need a different cursor
condition. Timings are from a single warm run on a developer machine and show the plan, not a benchmark.

## Final technical decisions

- [x] REST (Express) as the only API path
- [x] JavaScript (not TypeScript), a flat structure, `services/` only for risky logic
- [x] Sequelize 6 with tenant data access built here and enforced by static tests
- [x] JWT bearer in `localStorage`, with the XSS trade-off recorded in a decision record
- [x] Zod for validation
- [x] Jest + Supertest, a real Postgres, no Docker and no CI in this version
- [x] A minimal client without Redux
- [x] Deploy at the end of M1 (done: EC2 + Nginx + Vercel + Supabase)
