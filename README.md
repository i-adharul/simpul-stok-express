# Simpul Stok (Express version)

A multi-warehouse, multi-tenant inventory SaaS API with a small React client. It is the stock module of Simpul, a planned multi-branch operations platform.

The project exists to prove five things:

- stock never goes negative under concurrent requests;
- a transfer between warehouses is atomic;
- a repeated request does not repeat its effect (idempotency);
- one tenant can never read or change another tenant's data;
- a subscription and payment flow works (Xendit sandbox, milestone M2).

A sibling implementation of the same product (Next.js, TypeScript, Prisma) lives in `i-adharul/simpul-stok`. This repository builds the same product with Express and Sequelize.

## Status

Milestone M1 (core inventory) is complete and deployed.

- Demo (client): https://simpulstok.adharul.my.id
- API: https://simpulstok-api.adharul.my.id (`GET /api/health` shows the running commit)
- Plan limits (BL20) are enforced in the server and shown in the client: creating or restoring a warehouse or product, inviting a member and accepting an invitation answer `PLAN_LIMIT_REACHED` (403) above the plan limit.
- Server tests: 150 suites, 2478 tests, all passing against a local Postgres (`cd server && npm test`, last run 2026-11-10). The client builds with `cd client && npm run build`. There is no CI.

**Open follow-up:** the full P0 flow has **not** yet been verified end to end in production. The deployed API and client are live, but the main-flow test (E6-03) only runs against a local database.

Not built yet: the subscription and payment flow (M2) and later milestones.

## Stack

Node.js (CommonJS), Express 5, PostgreSQL, Sequelize 6, Zod, JWT bearer auth, Jest and Supertest. The client uses React, Vite, Tailwind and daisyUI. See [docs/05_Technical_Design.md](docs/05_Technical_Design.md) for the reasons and the rejected alternatives.

## Repository layout

```
server/   Express API
  scripts/deploy.sh    deploy on the EC2 host (pull, install, pm2 restart, health check)
  scripts/resetDemo.js demo data reset (npm run demo:reset)
client/   React + Vite client
  vercel.json          rewrites every path to /index.html so deep links work
docs/     Product and technical documents, and decisions/ (ADRs)
```

## Run the server

Requires Node.js 18 or higher.

```bash
cd server
npm install
npm run dev     # nodemon, http://localhost:3000
npm test        # Jest and Supertest, one test file at a time
```

Client (from `client/`): `npm run dev` for the Vite dev server, `npm run build` for the production build.

Deploy (on the EC2 host, not locally): `./server/scripts/deploy.sh [branch]`. Migrations are not part of it; see [ADR 0008](docs/decisions/0008-deployment-layout.md).

## Documentation

Start with [docs/README.md](docs/README.md). Architecture decisions are in [docs/decisions/](docs/decisions/). The UI is in Indonesian; code and documents are in English.

## Payments

Payments are sandbox only. No real money moves.

## AI-assisted development

An AI assistant (Claude) is used as a pair programmer, with the rules in [CLAUDE.md](CLAUDE.md).
