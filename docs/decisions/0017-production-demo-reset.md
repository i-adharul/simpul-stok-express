# ADR 0017: Daily demo reset on production (separate role, separate connection, explicit switch)

- Status: accepted
- Date: 2026-11-10

## Context
The public demo (ADR 0016) shares one organization between all visitors, so it must return to a known state
every day. The reset needs `TRUNCATE`: a stock movement cannot be deleted (append-only trigger, ADR 0005), so only
`TRUNCATE` can empty that table, and it empties it for every organization. Two earlier decisions point the other way:

- The application role `simpul_app` has no `TRUNCATE` on purpose (ADR 0007), and the `postgres` password is typed on a
  laptop and never stored on the server (ADR 0007).
- ADR 0008 says `demo:reset` never runs in production, and `SEED_ALLOW_REMOTE` stays `false` on the API host.

Also, visitors can sign up (`/register`), so a production database that serves the demo will hold organizations outside
the two demo ones. The reset script refuses in that case today, so a scheduled reset would refuse every night.

The production database was checked (read only) on 2026-11-10: one organization (`tokomaju`, trial, 3 users, no stock
movements) from the base seed. `DEMO_MODE` is off and no `DEMO_*_EMAIL` is set on the host.

## Decision
- **A third database role, `simpul_reset`, used by the reset script only.** It has `SELECT`, `INSERT`, `UPDATE`,
  `DELETE` and `TRUNCATE` on the tables and `USAGE`, `SELECT` on the sequences. It owns nothing, cannot create objects
  and cannot log in as anyone else. The `postgres` role creates it and applies the grants, from a laptop (ADR 0007);
  `simpul_app` keeps no `TRUNCATE`.
- **A separate connection, never the application one.** The script reads `DEMO_RESET_DATABASE_URL` (same Supabase session
  pooler and verified TLS as ADR 0007; user `simpul_reset.<project-ref>`). With `NODE_ENV=production` the script
  requires it, builds its own connection from it (it never opens the connection of `DATABASE_URL`) and refuses when the
  user is the same as the user of `DATABASE_URL`. Locally it is optional and the script keeps using the database
  that `NODE_ENV` picks.
- **The credential is not in `server/.env`.** It lives in a file outside the repository (`/home/ubuntu/.simpul-reset.env`,
  mode `600`) that only the cron wrapper reads, together with `SEED_ALLOW_REMOTE=true`, `SEED_PASSWORD` and the wipe
  switch. `pm2` and the API process never see these variables, so `SEED_ALLOW_REMOTE` stays `false` for the API (ADR 0008).
- **The API server never runs the reset.** No route, controller, service, middleware, `app.js` or `bin/www.js` imports
  `helpers/demoReset.js` or the script; a static test fails if one does. The only caller is `scripts/resetDemoCron.sh`,
  started by `crontab` of the host.
- **An explicit second switch: `DEMO_RESET_WIPE_OTHERS=true`.** Off by default. Without it the reset refuses when an
  organization outside the two demo organizations exists (as today). With it, those organizations are deleted with
  everything else, and the script prints how many there were. It is set only in the reset file of a server whose database
  serves the demo and nothing else. The existing guard stays: a non-local host needs `SEED_ALLOW_REMOTE=true`.
- **Schedule:** every day at 20:00 UTC, which is 03:00 WIB (WIB has no daylight saving). `flock` stops two runs from
  overlapping, and the output goes to `~/logs/demo-reset.log`.
- **`SEED_PASSWORD` in the reset file must be the password the base accounts already have**, because the reset seeds
  them again (including the platform admin). A different value would change that password.

## Alternatives considered
- **Run it as `postgres` from the host.** Rejected: stores the owner password on the server, which ADR 0007 avoids.
- **Give `simpul_app` the `TRUNCATE` privilege.** Rejected: a bug or an injection in the API could then erase the stock
  history, which is the thing ADR 0005 and 0007 protect.
- **Put `DEMO_RESET_DATABASE_URL` in `server/.env`.** Rejected: the API process would hold a credential it never needs.
- **Delete rows instead of `TRUNCATE`.** Impossible for stock movements (append-only trigger).
- **Delete only the sign-up organizations.** Rejected: movements cannot be deleted per organization, so partial cleanup is
  not available without dropping the trigger.
- **Trigger the reset from an API endpoint with a secret.** Rejected: the API would need the privileged connection, and a
  public route that can empty the database is a bigger risk than a cron entry.

## Consequences
- The credential with `TRUNCATE` exists on the server, in one file readable by one user. Losing the host means losing it:
  rotate the `simpul_reset` password then.
- Sign-up organizations and visitor data disappear every night. The README says so; a database with real customers must
  never get the switch, and its cron entry must be removed.
- `TRUNCATE` takes exclusive locks for a moment, so a request during the reset can fail. The window is 03:00 WIB.
- Tokens issued before the reset stop working (the users are created again with new ids), and the API answers 401.
- A new table needs a grant to `simpul_reset` too, and must be added to `TABLES` in `helpers/demoReset.js`.
- This narrows ADR 0008: `demo:reset` never runs as the application, and runs on the production database only through the
  scheduled wrapper.
