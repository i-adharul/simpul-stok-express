# ADR 0007: Supabase connection strategy (session pooler, verified TLS, two roles)

- Status: accepted
- Date: 2026-11-09

## Context

Production uses Supabase as plain PostgreSQL. The API runs on one EC2 host (ADR 0008) and holds a Sequelize pool
(`max: 10`, `acquire: 10 s`, ADR 0012). Every stock write opens a transaction and takes `SELECT ... FOR UPDATE` on the
warehouse row (ADR 0013), and migrations run DDL and a trigger (ADR 0005). Supabase offers a direct connection, a session
pooler (port 5432) and a transaction pooler (port 6543). Supabase only accepts TLS. The database also holds append-only
tables, and a trigger does not stop `TRUNCATE`.

## Decision

- **Session pooler, port 5432, for everything.** A row lock and a transaction live in one session, so the connection must
  stay bound to the client for the whole transaction. The transaction pooler can hand the session to another client between
  statements and is not used. The direct connection is not used because it needs IPv6 or a paid add-on from EC2.
- **Two roles.** `postgres` runs migrations and the base seed, from a laptop, with the password typed into the shell for
  that one command and never stored on the server. The running API connects as `simpul_app`, which has `SELECT`, `INSERT`,
  `UPDATE`, `DELETE` on the tables and `USAGE`, `SELECT` on sequences, and **no `TRUNCATE`**. This is the answer to the limit
  of ADR 0005: the append-only trigger blocks `UPDATE` and `DELETE` of movements, but only a missing privilege blocks
  `TRUNCATE`. Grants are applied after each migration that adds a table.
- **TLS is verified.** `config/config.js` sets `rejectUnauthorized: true` and reads the CA certificate from the file named by
  `DATABASE_CA_PATH` (required when `NODE_ENV=production`; the app stops at start without it). The certificate and host name
  are checked, so a man in the middle cannot present another certificate. The CA file lives outside the repository.
- **Pool exhaustion answers 503.** `ConnectionAcquireTimeoutError` becomes `SERVICE_UNAVAILABLE` (503, "retry later") instead of
  a generic 500.
- **Seeding a remote database needs a strong `SEED_PASSWORD`.** The public demo password is refused on any host that is not
  local.

## Alternatives considered

- **Transaction pooler:** more clients per connection, but breaks session-level assumptions (row locks across statements).
- **Direct connection:** no pooler in between, but not reachable from IPv4-only EC2 without an add-on.
- **`rejectUnauthorized: false`:** encrypts but does not authenticate the server. Rejected.
- **One role for everything:** simpler, but the app could `TRUNCATE` the history and own the schema. Rejected.

## Consequences

- The free tier limits connections: keep `pool.max` small. A burst longer than 10 s gets 503 instead of hanging.
- The CA certificate expires: put its renewal on the maintenance list. Until then the app cannot connect, and `/api/health`
  reports the database as down.
- A new table needs a grant to `simpul_app`, or the API answers 500 for it. The grants are part of the deploy checklist.
