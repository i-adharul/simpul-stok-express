# ADR 0004: Sequelize 6 and `sequelize-cli` for migrations and seeders

- Status: accepted
- Date: 2026-11-04

## Context

ADR 0001 chose Sequelize as the ORM. This record fixes the version and how the schema is managed.
The schema carries claims of the project (no negative stock, immutable movements, one subscription
per organization), so it must be reproducible from files, reviewable in a pull request, and
reversible.

## Decision

- **Sequelize 6** (`^6.37.8`, the `latest` tag on npm at the time of writing) with **`sequelize-cli`**
  for migrations and seeders. Version 7 is only published as an alpha and is not used.
- **`.sequelizerc`** points the CLI to `config/config.js`, `migrations/`, `models/` and `seeders/`.
  `config/config.js` is a JavaScript file that reads the validated environment, not `config.json`,
  so credentials never sit in a file that could be committed.
- **Environments:** `development` uses `DATABASE_URL`, `test` uses `TEST_DATABASE_URL`, `production`
  uses `DATABASE_URL` with TLS. The CLI picks the entry by `NODE_ENV`, and so does `models/index.js`.
- **The schema comes only from migrations.** Each migration has `up` and `down`, and
  `db:migrate`, `db:migrate:undo:all`, `db:migrate` must run cleanly. Models describe the tables for
  the application; they never create them.
- **Raw SQL inside migrations** only for what `queryInterface` cannot express cleanly: named CHECK
  constraints now, triggers and partial rules in later stories. Raw SQL in application code is
  limited to row locks and conditional updates.

## Alternatives considered

- **Prisma:** used in the sibling repository. A different ORM here shows the concepts do not depend
  on one.
- **Knex or `node-pg-migrate` for migrations:** another dependency and a second tool next to the ORM.
- **Sequelize 7 (alpha):** a pre-release API for a project whose point is correctness.
- **`sequelize.sync()`:** builds tables from models without history or rollback, and cannot add CHECK
  constraints or triggers.
- **`config/config.json`:** cannot read environment variables.

## Consequences

- Two descriptions of a table exist (the migration and the model). A test per table checks the
  database constraints, and the models test checks the associations, but a column added to only one
  of them is not detected automatically.
- The CLI is a dev dependency, so production deploys run migrations from a checkout that has it.
- Staying on version 6 means following its documentation, not the newer one.
- Revisit when Sequelize 7 has a stable release.
