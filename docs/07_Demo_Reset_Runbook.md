# Demo reset on production: runbook

Decision: [ADR 0017](decisions/0017-production-demo-reset.md). The public demo database is restored every day at
03:00 WIB (20:00 UTC) by `server/scripts/resetDemoCron.sh`, started by `crontab`. **Everything in that database is
deleted every time, including organizations created through sign-up.** Never do this on a database with real customers.

## One-time setup

Do the steps in this order: the crontab line points at a script that exists on the host only after the deploy.

1. **Role (laptop, as `postgres`).** Creates `simpul_reset` with `TRUNCATE` and nothing else. Make a random hex-only
   password and keep it in the password manager: the same password goes into the credential file in step 3. Hex
   characters need no URL encoding in the connection string, and the file is read with `source` in bash, so a special
   character (`$`, `#`, space, quote, `&`) would break the line.
   ```bash
   export RESET_PASSWORD="$(openssl rand -hex 24)"; echo "$RESET_PASSWORD"   # copy it to the password manager
   psql "$POSTGRES_URL" -v reset_password="$RESET_PASSWORD" -f server/scripts/demoResetRole.sql
   ```
   The last query of the file must show `TRUNCATE` for `simpul_reset` and not for `simpul_app`.
2. **Deploy this commit to the server.** `deploy.sh` takes the branch from its first argument (`BRANCH="${1:-main}"`,
   not from an environment variable); without an argument it deploys `main`. It does `cd` to `server/` by itself, so run
   it from the repo root on the host, `/srv/simpul-stok`:
   ```bash
   cd /srv/simpul-stok
   ./server/scripts/deploy.sh e15-04-demo-reset-production   # before the PR is merged
   ```
   It switches the host to that branch. After the merge, deploy `main` again with `./server/scripts/deploy.sh`.
3. **Host checks (before the cron line).**
   ```bash
   timedatectl                 # "Time zone: Etc/UTC" or "UTC": then 0 20 * * * is 03:00 WIB. Any other zone: shift the hour
   which flock                 # must print a path (package util-linux); the script refuses without it
   dirname "$(which node)"     # the directory for the PATH= line of the crontab (cron does not read the shell profile,
                               # so a Node installed with nvm is not found unless that directory is in PATH)
   mkdir -p ~/logs
   ```
4. **Credential file (on the host, outside the repository).** `~/.simpul-reset.env`, then `chmod 600 ~/.simpul-reset.env`:
   ```
   DEMO_RESET_DATABASE_URL=postgres://simpul_reset.<project-ref>:<RESET_PASSWORD>@<pooler-host>:5432/postgres
   SEED_ALLOW_REMOTE=true
   SEED_PASSWORD=<strong password, see below>
   DEMO_RESET_WIPE_OTHERS=true
   ```
   `<RESET_PASSWORD>` is the hex password of step 1. Not in `server/.env`: the API must not hold these.
   `SEED_PASSWORD` becomes the password of every base account after the reset, the Platform admin included, because the
   reset seeds them again. Keep it in the password manager. If it differs from the password those accounts have now,
   their passwords change at the first reset.
5. **Run once and check** (section below). Only when it is correct:
6. **Cron (host).** `crontab -e`, with the directory printed by `dirname "$(which node)"` in the `PATH=` line:
   ```
   PATH=<node directory>:/usr/local/bin:/usr/bin:/bin
   0 20 * * * /srv/simpul-stok/server/scripts/resetDemoCron.sh >> /home/ubuntu/logs/demo-reset.log 2>&1
   ```

## Manual run and check

```bash
/srv/simpul-stok/server/scripts/resetDemoCron.sh
tail -3 ~/logs/demo-reset.log
curl -fsS https://simpulstok-api.adharul.my.id/api/health
```
Expect `as role "simpul_reset.<project-ref>"` and `2 organizations, 6 warehouses and 100 products restored`.
`GET /api/health` answers `ok`. A person who was signed in has to sign in again (the users get new ids).

Read-only check in the Supabase SQL editor (do not run anything else there). Expect two demo organizations, about 3
warehouses and 50 products each:
```sql
SELECT o.name,
       (SELECT count(*) FROM "Warehouses"     w WHERE w."organizationId" = o.id) AS warehouses,
       (SELECT count(*) FROM "Products"       p WHERE p."organizationId" = o.id) AS products,
       (SELECT count(*) FROM "StockMovements" m WHERE m."organizationId" = o.id) AS movements
FROM "Organizations" o ORDER BY o.name;
```

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
