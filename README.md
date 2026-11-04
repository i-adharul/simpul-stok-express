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

Work in progress (epic E0, repository setup). The API answers every request with a JSON `404` because no routes exist yet. The client and the database are not set up yet.

## Stack

Node.js (CommonJS), Express 5, PostgreSQL, Sequelize 6, Zod, JWT bearer auth, Jest and Supertest. The client uses React, Vite, Tailwind and daisyUI. See [docs/05_Technical_Design.md](docs/05_Technical_Design.md) for the reasons and the rejected alternatives.

## Repository layout

```
server/   Express API
client/   React + Vite client
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

## Documentation

Start with [docs/README.md](docs/README.md). Architecture decisions are in [docs/decisions/](docs/decisions/). The UI is in Indonesian; code and documents are in English.

## Payments

Payments are sandbox only. No real money moves.

## AI-assisted development

An AI assistant (Claude) is used as a pair programmer, with the rules in [CLAUDE.md](CLAUDE.md).
