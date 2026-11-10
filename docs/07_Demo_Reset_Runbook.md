# Demo reset on production: runbook

Decision: [ADR 0017](decisions/0017-production-demo-reset.md). The public demo database is restored every day at
03:00 WIB (20:00 UTC) by `server/scripts/resetDemoCron.sh`, started by `crontab`. **Everything in that database is
deleted every time, including organizations created through sign-up.** Never do this on a database with real customers.

## One-time setup

1. **Role (laptop, as `postgres`).** Creates `simpul_reset` with `TRUNCATE` and nothing else:
   ```bash
   read -rs RESET_PASSWORD; export RESET_PASSWORD      # a new strong password, typed, not stored
   psql "$POSTGRES_URL" -v reset_password="$RESET_PASSWORD" -f server/scripts/demoResetRole.sql
   ```
   The last query of the file must show `TRUNCATE` for `simpul_reset` and not for `simpul_app`.
2. **Credential file (on the host, outside the repository).** `~/.simpul-reset.env`, mode `600`:
   ```
   DEMO_RESET_DATABASE_URL=postgres://simpul_reset.<project-ref>:<password>@<pooler-host>:5432/postgres
   SEED_ALLOW_REMOTE=true
   SEED_PASSWORD=<the password the base accounts already have>
   DEMO_RESET_WIPE_OTHERS=true
   ```
   Not in `server/.env`: the API must not hold these. `SEED_PASSWORD` must be the password the base accounts have now,
   because the reset seeds them again (the platform admin included).
3. **Cron (host).** `mkdir -p ~/logs && crontab -e`, with the real path of `node` (`dirname "$(which node)"`):
   ```
   PATH=/usr/local/bin:/usr/bin:/bin
   0 20 * * * /home/ubuntu/simpul-stok-express/server/scripts/resetDemoCron.sh >> /home/ubuntu/logs/demo-reset.log 2>&1
   ```
4. Deploy the commit that holds these files (`./server/scripts/deploy.sh`).

## Manual run and check

```bash
~/simpul-stok-express/server/scripts/resetDemoCron.sh
tail -3 ~/logs/demo-reset.log
```
Expect `as role "simpul_reset.<project-ref>"` and `2 organizations, 6 warehouses and 100 products restored`.
Then `GET /api/health` answers `ok`. A person who was signed in has to sign in again (the users get new ids).

## When it fails

| Log line | Meaning |
| --- | --- |
| `refused: ... mode 644, it must be 600` | `chmod 600 ~/.simpul-reset.env` |
| `DEMO_RESET_DATABASE_URL is required in production` | the variable is missing in the file |
| `same database user as DATABASE_URL` | the file holds the application role: use `simpul_reset` |
| `Refusing to seed: the database host ... is not local` | `SEED_ALLOW_REMOTE=true` is missing in the file |
| `an organization other than the demo ones exists` | `DEMO_RESET_WIPE_OTHERS=true` is missing in the file (or the database is not demo-only: stop) |
| `permission denied for table` | a table was added after the grants: run `demoResetRole.sql` again and add it to `TABLES` |

A failure after the `TRUNCATE` leaves an empty demo: run the script again.

## Stopping it

`crontab -e` and delete the line. To remove the power completely: `DROP OWNED BY simpul_reset; DROP ROLE simpul_reset;` as
`postgres`, and delete `~/.simpul-reset.env`.
