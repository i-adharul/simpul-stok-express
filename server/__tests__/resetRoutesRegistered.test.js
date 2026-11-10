const { TENANT_ENDPOINTS, allowedRoles } = require("./support/registry");
const { EXEMPT_ROUTES, PUBLIC_ROUTES } = require("./support/exemptions");

// E7-09: the three password reset routes are in the right list of the route registry (rule 16).
// routeRegistry.test.js already fails for ANY route that is missing; this one names the reset routes
// so removing an entry cannot go unnoticed, and pins who may call the tenant one.
describe("password reset routes in the registry", () => {
  it("POST /members/:id/reset-link is a tenant entry, Owner only, and not in a list that skips the harness", () => {
    const found = TENANT_ENDPOINTS.filter((entry) => entry.method === "post" && entry.path === "/api/members/:id/reset-link");

    expect(found).toHaveLength(1);
    expect(found[0].action).toBe("member.manage");
    expect(allowedRoles(found[0])).toEqual(["OWNER"]);
    expect(Object.keys({ ...PUBLIC_ROUTES, ...EXEMPT_ROUTES })).not.toContain("POST /members/:id/reset-link");
  });

  it.each(["GET /auth/reset-password/:token", "POST /auth/reset-password"])("%s is a public route with a reason", (label) => {
    expect(Object.keys(PUBLIC_ROUTES)).toContain(label);
    expect(PUBLIC_ROUTES[label].length).toBeGreaterThan(20);
    const [method, path] = label.split(" ");
    expect(TENANT_ENDPOINTS.some((entry) => entry.method === method.toLowerCase() && entry.path === `/api${path}`)).toBe(false);
  });
});
