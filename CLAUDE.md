# CLAUDE.md

Working agreement for AI assistants in this repository. Read it fully before changing anything. If code and this file disagree, stop and tell the maintainer; do not silently pick one.

## Project

Simpul Stok (Express version): a multi-warehouse, multi-tenant inventory SaaS API with a small React client. It exists to **prove** five things: stock never goes negative under concurrency, transfers between warehouses are atomic, repeated requests do not repeat their effect (idempotency), one tenant can never read or change another tenant's data, and a subscription and payment flow (Xendit sandbox, milestone M2).

A sibling implementation of the same product (Next.js, TypeScript, Prisma) lives in `i-adharul/simpul-stok`. This repository builds the same product with Express and Sequelize. Product rules, data model and endpoint list are identical; only the tooling differs.

Only the stock module is built. HR and POS modules are ideas, never scaffold them.

`docs/` holds the product and technical documents in English. `docs/04_API_Spec.md` is the contract of every endpoint (fields, status codes, error codes, response bodies): read the section of the endpoint you build and follow it. `docs/02_Functional_Spec.md` holds the business rules (BL), screens and popups. If code and docs disagree, stop and tell the maintainer; do not silently pick one.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime and language | Node.js, JavaScript (CommonJS). No TypeScript |
| API | Express 5, REST, JSON only |
| Database | PostgreSQL. Local database for dev and test; Supabase for demo and production |
| ORM and migrations | Sequelize 6 with `sequelize-cli` (migrations, seeders). Raw SQL only for locks, triggers and conditional updates |
| Validation | Zod |
| Auth | JWT bearer in the `Authorization` header, `bcryptjs`, `jsonwebtoken`. Token kept in `localStorage` by the client |
| Tests | Jest 30 and Supertest, real Postgres, `--runInBand`, Tests hash passwords with cost 4 (Jest only); production uses 12 |
| Client | React 19, Vite, Tailwind, daisyUI, axios, react-router, a small `AuthContext`. No Redux |
| Deploy | API on EC2 (`pm2`, Nginx, Let's Encrypt) at https://simpulstok-api.adharul.my.id; client on Vercel at https://simpulstok.adharul.my.id; database on Supabase. Live since M1 |

Not used on purpose: Docker, CI, Redis, email sending, rate limiting, TypeScript, Redux, Playwright.

## Structure

```
server/
  bin/www.js  app.js
  config/        config.js (sequelize-cli, reads env), env.js (loads and validates env), envSchema.js (Zod schema, pure parseEnv)
  migrations/  models/  seeders/
  routes/        index.js + one file per resource
  controllers/   thin: read the request, call a service or tenant data access, reply
  services/      auth, stock, transfer, idempotency, invitation, member, organization, passwordReset, planLimit (billing in M2)
  schemas/       Zod schemas per resource
  middlewares/   authentication, authorization, validate, idempotencyKey,
                 subscriptionGuard, requestLogger, errorHandler
  helpers/       bcrypt, jwt, errors (AppError), tenantScope, ownership,
                 permissions, password, pagination, logger
  scripts/       resetDemo.js (demo database reset), deploy.sh (pull, install, restart, health)
  __tests__/     support/ (DB reset, factories, endpoint registry)
client/          views, layouts, components, constants, utils, context
docs/            English docs and decisions/ (ADRs)
```

Flow: `request -> routes -> middlewares -> controller -> service -> model -> database`.
Services exist only for risky logic (login and session, stock changes, transfers, idempotency, billing). Simple CRUD controllers may call tenant data access directly. Dependency direction: stock services may call billing services, never the reverse.

Split into per-domain folders only when one folder passes about 12 to 15 files or imports become circular.

## Rules

Every rule has a test or a static check where possible. Do not weaken a test to make it pass.

1. `organizationId` comes only from `req.ctx`, which is built from the user loaded from the database. Never from body, query or params.
2. An ID in a URL that belongs to another organization, does not exist, or is not a UUID is answered with **404**, never 403, so existence does not leak. The role check comes first: a role that may not perform the action gets 403 even for another organization's ID. A foreign ID inside a request body gets the same answer as a random UUID (403 where the warehouse is authorized first, 404 where a row is looked up).
3. Tenant data is read and written only through `helpers/tenantScope.js` and `helpers/ownership.js`. Controllers and services do not import models directly (a static test enforces this; exceptions are listed in the test).
4. Every write route (POST, PUT, PATCH, DELETE) validates input with a Zod schema through `validate`. Unknown keys are rejected. A static test fails if a write route has no schema.
5. Configuration is read only from the validated `env` object in `config/env.js`. `config/config.js` is the single exception (sequelize-cli).
6. Every stock change runs inside one `sequelize.transaction`.
7. Every stock write takes the warehouse lock first (`services/warehouseLock.js`, `SELECT ... FOR UPDATE`). Transfers lock both warehouses in ID order to avoid deadlocks.
8. Decrements are conditional atomic updates (`quantity >= n`) and the affected-row count is checked. `CHECK (quantity >= 0)` in the database is the last safety net, not the first.
9. Endpoints that change stock require an `Idempotency-Key` header (UUID). The unique key in the database is the single source of truth.
10. `StockMovement` and `AuditLog` rows are append-only (database trigger). Business data is archived, never hard-deleted (except `IdempotencyKey`, the `UserWarehouse` link rows, and `Invitation`. `UserWarehouse` has no archive column and the assignment of a warehouse is replaced as a whole, BL10, so `PUT /api/warehouses/:id/members` deletes the rows that are no longer wanted. A cancelled `Invitation` is deleted, `DELETE /api/invitations/:id`).
11. Secrets live only in environment variables, never in the repo, logs or error bodies. Never commit `.env`; only `.env-template.txt`. Logs redact `password`, `authorization` and `token` fields, and request bodies are not logged.
12. Errors are `{ code, message, details }` through `AppError` and the error handler. No stack trace or SQL in a response. Login gives the same message for a wrong email and a wrong password.
13. No new dependency without a written reason (PR description or ADR).
14. Language: code, comments, commit messages, issues, PRs and repository docs are in English. Walkthroughs and chat with the maintainer are in Indonesian. UI text is in Indonesian.
15. Dates are stored in UTC and displayed in WIB (Asia/Jakarta).
16. Every new endpoint is added to the tenant-isolation registry and the role tests. A test fails if an Express route is missing from the registry.
17. Write routes pass the subscription check (BL23) in one place only: `middlewares/subscriptionGuard.js`. The temporary always-active version lives in that single file until M2.

## Commands

```bash
cd server
npm run dev                          # start with nodemon
npm test                             # all tests, one file at a time (--runInBand)
npx jest --runInBand path/to/file.test.js        # one file
npx jest --runInBand -t "test name"              # one test
# Always --runInBand: there is one test database and every file empties its tables. Parallel runs fail with foreign key errors.
npx sequelize db:migrate             # apply migrations (dev database)
npx sequelize db:migrate:undo:all    # roll everything back
npx sequelize db:seed:all             # base seed (remote needs SEED_ALLOW_REMOTE=true and a strong SEED_PASSWORD; on production seed plans and base-accounts one by one with --seed)
npm run demo:reset                    # restore the demo database (uses TRUNCATE; never on production)
cd ../client && npm run dev          # Vite dev server
cd ../client && npm run build
# On the EC2 server, from the repo root: ./server/scripts/deploy.sh (pull, install, set COMMIT_SHA, restart pm2, health check)
```

There is no CI. Run `npm test` before every push and put the real result in the PR description.

## Workflow

- One story = one GitHub issue `[E4-02] Title` with an ordered **Steps** checklist. Each step is done with one run of `/step <story-id> <step-number>` and nothing more.
- Branch `e4-02-short-slug`. For a story that has both backend and UI steps, the UI part uses branch `e4-02-ui`.
- Small commits: `E4-02: add receive service with transaction`. No AI attribution trailers (AI-assisted development is disclosed in the README).
- PR title equals the issue title. Use `Closes #nn` when the PR finishes the story, `Refs #nn` when UI steps are still open. Squash merge. The maintainer merges, not the assistant.
- Test first when a step has a business rule. Run the relevant tests before committing. A step that is intentionally red (E5-01, E5-02) says so in its commit message and walkthrough.
- Decision records: the numbers 0001 to 0014 are reserved in `docs/decisions/README.md`. A step that says "tulis ADR 00NN" writes that record in English (with `/step` the status is `proposed`, then `accepted` after the maintainer agrees; in `/story` and `/epic` the record is written as `accepted` and is accepted by merging its PR).
- Public issues and PRs never contain personal career words (CV, job applications, interviews, bootcamp, vacancies).

## How to assist

The maintainer must be able to explain every file without looking at the screen.

- Do exactly the requested step. Do not start the next step, and do not refactor unrelated code.
- For stories marked `critical` (login and sessions, tenant data access, stock changes, transfers, idempotency, later webhooks): first explain the approach and alternatives in Indonesian in 5 to 8 lines and **wait for the maintainer to say continue**, then write code in small pieces.
- For other stories: state the plan in 3 to 5 lines, then implement.
- Keep functions small enough that one line of the walkthrough maps to one function.
- Do not trust remembered library versions or APIs. Check the official docs for Express 5, Sequelize 6, Zod, jsonwebtoken, Jest, Supertest and Xendit before relying on them.
- When reviewing code, look for tenant leaks, race conditions and unhandled errors.
- After the step, write the walkthrough, then ask the comprehension questions and stop.

## Walkthrough rule

For every step, write `notes/walkthroughs/<story-id>-step<N>.md` (local folder, never committed) and summarize it in the reply (at most about 40 lines). Language: Indonesian. Code, file names, column names and technical terms stay in English.

It must contain:

1. **Peta file:** each new or changed file with one line on its purpose.
2. **Urutan panggilan dan nilai yang lewat.** A table, in execution order:

   | # | file:baris | Menerima | Mengirim ke / mengembalikan |
   | --- | --- | --- | --- |

   For an endpoint also state: method and path, which roles may call it, inputs (params, query, headers, body and the Zod schema), every database read or write (the Sequelize call, the table, and whether it runs inside a transaction), and every place the flow can stop (each `return` or thrown `AppError` with its status code and response body).
3. **Fungsi lain:** what it receives, what it returns, who calls it, and its side effects.
4. **Cara mengamati**, with concrete commands, using the tags `HTTP`, `LOG`, `BP`, `DB`, `TEST`, `UI`:
   - `HTTP`: the request to send as an entry in `http/<resource>.http` (or Postman), and the expected status and body;
   - `LOG`: where to put a temporary `console.log` and the output to expect in the terminal running `npm run dev` (server logs never appear in the browser console). Remind to remove it before committing;
   - `BP`: which line to put a breakpoint on (VS Code JavaScript Debug Terminal) and which variables to inspect;
   - `DB`: the SQL to run in DBeaver before and after;
   - `TEST`: the test command, and one thing to break on purpose to see the test fail;
   - `UI`: what to look at in the browser Network tab and Local Storage.
5. **Kenapa begitu:** the concept behind each non-obvious step, in plain words.
6. **Sumber dokumentasi resmi:** a table with the code pattern or file, the official link, the section followed, and any deviation with the reason. Only official sites. Open every link with a fetch tool and confirm the page and section exist. Never guess a URL; write "tidak terverifikasi" if a page is missing. Record the date checked and the version read.
7. **Pertanyaan cek pemahaman:** two or three short questions the maintainer answers in chat (for example "kalau langkah X dihapus, tes mana yang gagal dan kenapa?").

For a step without endpoints (a migration), cover each column, constraint, trigger and statement with the reason it exists, plus the `DB` commands that show the result.

## Out of scope

HR and POS modules, Redis, email sending, rate limiting, Docker, CI, TypeScript, Redux, Playwright. If a task seems to need one of them, stop and ask.
