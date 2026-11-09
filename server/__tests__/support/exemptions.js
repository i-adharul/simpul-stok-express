// Routes the cross-tenant harness does not attack, each with a written reason. A route must be in
// exactly one of: TENANT_ENDPOINTS (registry.js), EXEMPT_ROUTES, PUBLIC_ROUTES. Labels are
// "<METHOD> <path as declared in the router>". Keep these short and keep the reasons honest.

// A tenant route that cannot be tested the normal way (it has no ID the harness can swap for another
// organization's). Each entry names the test that proves its isolation instead.
const EXEMPT_ROUTES = {
  "GET /organization": "No ID in the URL, so the harness has no foreign ID to try: the row is chosen by ctx.organizationId only. Proven by organization.isolation.test.js.",
  "PATCH /organization": "No ID in the URL and no ID field in the body (organizationId is rejected as an unknown key): the row is chosen by ctx.organizationId only. Proven by organization.isolation.test.js.",
};

// Not tenant data at all: no ID from outside is looked up in another organization's data, and
// the code behind them must not use the tenant data access.
const PUBLIC_ROUTES = {
  "GET /health": "Health check: no session and no tenant data.",
  "POST /auth/login": "Before any session exists: the organization is not known yet.",
  "POST /auth/register-organization": "Public sign-up: no organization exists yet, so there is no tenant data to read; the service creates the organization and never uses the tenant data access.",
  "POST /auth/logout": "Reads no input and no tenant data; always answers 204.",
  "GET /me": "Acts on the caller's own user only (from the token); no ID comes from the URL or the body.",
  "PATCH /me/password": "Acts on the caller's own user only (from the token); no ID comes from the URL or the body.",
};

module.exports = { EXEMPT_ROUTES, PUBLIC_ROUTES };
