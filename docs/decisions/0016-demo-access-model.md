# ADR 0016: Demo access model

- Status: accepted
- Date: 2026-11-10

## Context
A visitor should be able to try the product with one click, without typing a password and without
creating an account. The demo must not weaken the real product: tenant isolation, sessions and the
password rules stay the same for everyone, and a production server that does not want a demo must
not offer one. The demo accounts are shared by every visitor and their data is public, so they need
their own safeguards (E15-02) and a reset (E14-01).

## Decision
- **A switch in configuration.** `DEMO_MODE` (off by default) and the three demo emails
  (`DEMO_OWNER_EMAIL`, `DEMO_ADMIN_EMAIL`, `DEMO_VIEWER_EMAIL`) are read once, validated by Zod in
  `config/envSchema.js` and used from the `env` object only. When `DEMO_MODE` is on, the three
  emails are required, valid and different from each other.
- **The list of demo accounts is configuration, not data.** No `isDemo` column, no table. The
  platform admin is never in the list, so it cannot be signed in by this door. The accounts are the
  ones the demo seed creates, one Owner, one Warehouse Admin and one Viewer of one organization.
- **One public endpoint.** `POST /api/auth/demo-login` takes `{ role }` (`OWNER`, `WAREHOUSE_ADMIN`,
  `VIEWER`). The role picks an email from the list; the request never carries an email or an
  organization (rule 1). It answers `404` when `DEMO_MODE` is off, with the same body as an unknown
  route, so a server without a demo does not announce one. Any other role is `400`.
- **A normal token.** The same signed JWT as login, 8 hours, containing only `sub`, `iat` and `exp`.
  Every later request loads the user from the database, so the usual checks (active user, role,
  tenant) apply unchanged. An inactive demo account is never signed in.
- **The password stays secret.** The real password of the demo accounts is `SEED_PASSWORD` in the
  environment of the seeder, never in the repository. The visitor never needs it.
- **Safeguards are a separate decision of the same family** (E15-02): an account in the list cannot
  change its password, receive a reset link, be deactivated or change role, because that would
  lock every other visitor out. The reset script restores the demo data periodically.

## Alternatives considered
- **An `isDemo` flag on `User` or `Organization`.** Rejected: a column anyone with write access to
  the data could flip, and a migration for something that is a deployment choice. A list in the
  environment is visible in one place and cannot be changed by a request.
- **Publishing the demo password on the login screen.** Rejected: it works with no new endpoint, but
  then the password is public in every environment where the accounts exist, and a visitor could
  change it. The seeder already refuses the public password on a remote database.
- **A fresh demo organization per visitor.** Rejected for now: it shows isolation best, but needs
  creation, expiry and cleanup of organizations, and it would break the append-only stock history on
  cleanup (ADR 0005). Shared accounts and a periodic reset are far simpler.
- **A magic link or one-time code by email.** Rejected: email sending is out of scope.

## Consequences
- With `DEMO_MODE` off (the default) there is no new attack surface beyond a route that answers 404.
- With it on, anyone can obtain a valid token for the three accounts. That is the point, so it must
  only be on for a database that holds public demo data, never one with real customers.
- All visitors share one organization, so they see each other's changes until the next reset. The
  reset uses `TRUNCATE` and refuses to run when an organization other than the demo ones exists.
- A demo token cannot be revoked before it expires (ADR 0009); the damage is bounded by the
  safeguards and the reset.
- Adding a fourth demo role or account means a new environment variable and a change to the
  validation, on purpose.
