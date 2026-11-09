// Routes the cross-tenant harness does not attack, each with a written reason. A route must be in
// exactly one of: TENANT_ENDPOINTS (registry.js), EXEMPT_ROUTES, PUBLIC_ROUTES, PLATFORM_ROUTES. Labels are
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
  "POST /auth/accept-invite": "Public: the person has no account yet and the token in the body is the proof. The organization comes from the invitation row found by the token hash, never from the request.",
  "GET /invitations/:token": "Public: the person who opens the link has no account yet. The token is looked up by its hash; every invalid token is one identical 404, so there is no foreign ID to swap.",
  "GET /auth/reset-password/:token": "Public: the person who opens the reset link has no session. The token is looked up by its hash; every invalid token is one identical 404, so there is no foreign ID to swap.",
  "POST /auth/reset-password": "Public: the member has no session and the token in the body is the proof. The user is found by the token hash, never by anything from the request, and the service never uses the tenant data access.",
  "POST /auth/logout": "Reads no input and no tenant data; always answers 204.",
  "GET /me": "Acts on the caller's own user only (from the token); no ID comes from the URL or the body.",
  "PATCH /me/password": "Acts on the caller's own user only (from the token); no ID comes from the URL or the body.",
};

// Platform admin routes (/api/platform/*): they read across tenants on purpose through
// helpers/platformAccess.js, so the harness cannot swap an organization's ID for a foreign one.
// Their rule is the opposite one: only a Platform admin may call them, a tenant role gets 403 and no
// token gets 401 (proven for every label by platformRoutes.test.js). Empty until E11-03 adds the
// first one; each label needs a written reason, like the other lists.
const PLATFORM_ROUTES = {};

module.exports = { EXEMPT_ROUTES, PUBLIC_ROUTES, PLATFORM_ROUTES };
