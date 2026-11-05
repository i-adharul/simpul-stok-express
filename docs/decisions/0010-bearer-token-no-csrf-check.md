# ADR 0010: Bearer token instead of a cookie: no CSRF check, and the XSS trade-off

- Status: accepted
- Date: 2026-11-05

## Context

The API and the client are separate applications on different origins (the API on EC2, the client on Vercel).
[ADR 0009](0009-stateless-signed-jwt.md) fixes the session as a signed JWT. The remaining question is how the
client presents it, and what that means for two classic web risks: cross-site request forgery (CSRF) and
cross-site scripting (XSS). Story E1-06 also adds `helmet` and a CORS allowlist, so the decision has to say
what those do and do not protect.

## Decision

- The client keeps the token in `localStorage` and sends it on every request as
  `Authorization: Bearer <token>`. The server never sets a cookie.
- **No CSRF check.** A browser attaches cookies by itself, so a page on another site can make it send an
  authenticated request. It does not attach an `Authorization` header by itself, so a request forged from
  another site carries no token. There is nothing for a CSRF token or an `Origin` check to protect.
- **CORS is an allowlist.** `CORS_ORIGIN` lists the exact origins of the client. Any other origin gets no
  `Access-Control-Allow-Origin` header, so its page cannot read responses. There is no wildcard (the
  environment schema refuses `*`) and `credentials` is not enabled. CORS is a browser rule, not
  authentication: the server still handles a request from an unlisted origin, and every protected route
  still needs a valid token.
- **`helmet` with its defaults** sets the security headers on every response, errors included, and removes
  `X-Powered-By`.
- **The XSS trade-off is accepted.** A script injected into the client could read `localStorage` and steal the
  token; an `httpOnly` cookie would hide it from scripts. Mitigations in this version:
  - the token lives for at most 8 hours and is never extended (ADR 0009);
  - user text is rendered through plain React (no `dangerouslySetInnerHTML`);
  - all input is validated on the server (Rule 4) and `helmet` sets a restrictive Content-Security-Policy on
    the API;
  - the user is read from the database on every request, so deactivating a user or changing a password
    ends a stolen session at once.

## Alternatives considered

- **An `httpOnly` cookie on the API domain.** Rejected for this version: the client and the API are on
  different registrable domains, so the cookie would be third-party (blocked by browsers) unless both move
  behind one domain or a proxy. It would also bring back CSRF, which needs its own defence.
- **A cookie plus an `Origin` check or a double-submit CSRF token.** Rejected: more moving parts on every write
  route for no gain over a bearer header.
- **Keeping the token only in memory.** Rejected: a page reload would sign the user out, which hurts the
  warehouse workflow on mobile.

## Consequences

- A stolen token works from any machine until it expires (at most 8 hours), is invalidated by a password
  change, or the user is deactivated. Logging out only deletes the token on the client.
- Every client code path that renders server text must stay free of raw HTML injection; this is a review
  rule, and the client has no tests for it yet.
- Moving the client and the API under one domain and switching to an `httpOnly` cookie is a possible later
  improvement. It would reopen the CSRF question and replace this decision.
- Adding a request header the browser must send (for example another custom header) requires adding it to
  `allowedHeaders` in `app.js`, otherwise the preflight fails.
