# ADR 0009: A stateless signed JWT (no session table)

- Status: accepted
- Date: 2026-11-05

## Context

Login (E1-02, BL01) must give the client a session that lasts 8 hours and that every later request can check.
The stack fixes the tools (`jsonwebtoken`, `bcryptjs`, a bearer token in the `Authorization` header; see
`docs/05_Technical_Design.md`), but not the shape of the session. Access must also be cut quickly: BL07 says a
deactivation takes effect at once, and BL01 says a token issued before the last password change is rejected.

## Decision

- The session is a **JWT signed with HS256** by `jsonwebtoken` using `JWT_SECRET` (at least 32 characters,
  validated at start). Verification pins the algorithm (`algorithms: ["HS256"]`), so `alg: none` and other
  algorithms are refused.
- The token holds only `sub` (the user ID), `iat` and `exp`. It does **not** hold the role, the organization or
  the status.
- The lifetime is **fixed at 8 hours** (`JWT_EXPIRES_IN=8h`) and is never extended: there is no refresh token.
- There is **no session table**. On every request the user is read again from the database; revocation works
  through `isActive` (BL07) and by comparing the token's `iat` with `passwordChangedAt` (BL01, whole seconds).
- Passwords are hashed with `bcryptjs` at cost 12. bcrypt silently ignores everything after byte 72, so a
  password longer than 72 bytes is refused when it is set (`helpers/password.js`) and never compared at login
  (`helpers/bcrypt.js`).
- Every login failure (unknown email, wrong password, inactive user, over-long password) returns the same
  `401 INVALID_CREDENTIALS` with the same message. For an unknown email the service still runs one bcrypt
  comparison against a dummy hash, so the response time does not reveal whether the email exists.
- The login response and every `/api/auth/*` response carry `Cache-Control: no-store`.

## Alternatives considered

- **Sessions stored in the database.** Rejected: one more table and one more query on every request for a
  benefit (revoking a single session) that the product does not need. The per-request user lookup already
  covers the revocation cases that matter.
- **An opaque random token looked up on the server.** Rejected for the same reason: it needs a store, and with
  no Redis in this version the store would be Postgres.
- **A refreshed or sliding session.** Rejected: BL01 asks for a fixed 8 hours, and a refresh needs a second
  token and a write on read paths.
- **Role and organization inside the token.** Rejected: they could be stale for up to 8 hours after a role
  change or a deactivation, and the tenant must come from trusted data (Rule 1).
- **argon2 instead of bcrypt.** Rejected: a new dependency (Rule 13) and the stack already names `bcryptjs`.

## Consequences

- A single session cannot be revoked. Logging out only deletes the token on the client; a stolen token stays
  valid until it expires (at most 8 hours) unless the user is deactivated or changes the password.
- Changing `JWT_SECRET` signs everyone out, which is also the emergency revocation switch.
- Every request pays one user lookup; this is also needed for the subscription check (BL23).
- There is no rate limiting on login in this version (deferred). Brute force is limited only by bcrypt's cost.
- Where the token is kept on the client (`localStorage`) and the CSRF and XSS consequences are a separate
  decision (ADR 0010, E1-06).
