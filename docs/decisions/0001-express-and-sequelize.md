# ADR 0001: Express and Sequelize as the stack

- Status: proposed
- Date: 2026-11-03

## Context

Simpul Stok must prove a few things: stock never goes negative under concurrent requests,
transfers are atomic, repeated requests do not repeat their effect, and one tenant can
never see another tenant's data. The same product is already built in a sibling repository
with Next.js, TypeScript and Prisma. The core ideas (transactions, row locks, conditional
atomic updates, idempotency keys, tenant scoping) do not depend on a framework or an ORM.

This repository builds the same product with a different stack, to show that. It is built
and run by one person, so the stack must be small enough to explain completely.

## Decision

- **API:** Express 5, a separate REST API in `server/`, JavaScript with CommonJS.
- **Client:** a separate React + Vite app in `client/`. It talks to the API over HTTP with a
  bearer token.
- **Database access:** PostgreSQL through Sequelize 6, with `sequelize-cli` for migrations
  and seeders. Raw SQL is used only where the ORM cannot express the rule (row locks,
  triggers, conditional updates).
- **Validation:** Zod, one schema per endpoint.
- **Tests:** Jest and Supertest against a real Postgres, one test file at a time.

The full list, with the reason for each choice, is in `docs/05_Technical_Design.md`.

## Alternatives considered

- **Next.js fullstack (the sibling repository):** one deployment and shared types, but it
  hides the request flow behind the framework and repeats what the sibling already shows.
- **NestJS:** good structure, but decorators and dependency injection hide the flow that
  this project wants to make visible.
- **Prisma instead of Sequelize:** already used in the sibling. A different ORM here shows
  that the concepts are not tied to one tool.
- **TypeScript:** Sequelize typing is weak and the extra weight does not add to the claims
  being proved.
- **Sequelize 7:** still an alpha release at the time of writing. Sequelize 6 is the stable
  line.

## Consequences

- The API and the client are two deployments on different domains. The API needs CORS, and
  authentication uses a bearer token instead of a cookie (a separate decision).
- Express 5 forwards errors thrown in `async` handlers to the error handler, so controllers
  need no `try/catch` wrappers. Express 5 requires Node.js 18 or higher.
- There is no type checker. Zod validates input at the boundary, and the tests carry the
  rest of the safety net.
- Sequelize has no built-in tenant filter. Tenant isolation is built explicitly in a data
  access helper and proved by tests (a separate decision).
- Check the official documentation for Express 5 and Sequelize 6 before using an API from
  memory. Many examples online target Express 4.
