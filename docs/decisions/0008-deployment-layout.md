# ADR 0008: Deployment layout (EC2 with pm2 and Nginx, client on Vercel)

- Status: accepted
- Date: 2026-11-09

## Context

M1 ends with the API, the database and the client online. The client (Vercel) and the API (EC2) are on different origins,
which is why the token is a bearer header and CORS lists origins (ADR 0010). The project wants to show basic infrastructure
work, so the API is not on a managed platform.

## Decision

- **API:** one EC2 instance with an Elastic IP, at `https://simpulstok-api.adharul.my.id`. Node runs `server/bin/www.js` under
  `pm2` (name `simpul-api`, started at boot with `pm2 startup` and `pm2 save`) on port 3000 bound to the machine. Nginx
  terminates TLS (Let's Encrypt, automatic renewal) and proxies to `127.0.0.1:3000`; HTTP redirects to HTTPS. The security group
  opens 80 and 443 to everyone and 22 only to the maintainer.
- **Client:** Vercel project with root directory `client`, `VITE_API_URL` set at build time, at `https://simpulstok.adharul.my.id`
  (DNS only in Cloudflare). `client/vercel.json` rewrites every path to `/index.html` so deep links work.
- **Configuration:** `server/.env` on the host (not in the repository) holds `NODE_ENV=production`, `DATABASE_URL`
  (`simpul_app`), `DATABASE_CA_PATH`, `JWT_SECRET`, `JWT_EXPIRES_IN` and `CORS_ORIGIN` with only the client domain. A
  production host sets no `TEST_DATABASE_URL`, and `SEED_ALLOW_REMOTE` stays `false`.
- **`COMMIT_SHA` is set by the deploy command, not by hand-editing `.env`.** `server/scripts/deploy.sh` pulls the branch,
  installs production dependencies and restarts with `COMMIT_SHA=$(git rev-parse --short HEAD) pm2 restart simpul-api
  --update-env`. A variable in the shell wins over `.env`, so `GET /api/health` always shows the commit that runs. The script
  ends by calling `/api/health`.
- **Migrations are not part of the deploy script.** They run from a laptop as the `postgres` role (ADR 0007) with
  `npx sequelize db:migrate --env production`, then the grants to `simpul_app` are applied. Only the plans and base-accounts
  seeders run in production, one at a time, with `SEED_PASSWORD`; never `db:seed:all` and never `demo:reset`.
- **Database role limit:** the application role has no `TRUNCATE` (ADR 0007).

## Alternatives considered

- **Managed platform for the API (Render, Fly):** faster, but hides what this project wants to show.
- **Docker on EC2:** more moving parts for one process; out of scope for this repository.
- **Migrations on the server during deploy:** would need the owner password on the server. Rejected.
- **Writing `COMMIT_SHA` into `.env`:** can go stale after a pull without a restart.

## Consequences

- One instance means a restart drops in-flight requests for a moment, and there is no redundancy.
- Updates are manual (SSH, then the script). There is no CI in this project (CLAUDE.md), so the maintainer runs `npm test`
  before pushing.
- The EC2 host, the Let's Encrypt renewal and the CA certificate expiry are maintained by hand.
