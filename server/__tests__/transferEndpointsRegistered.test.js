const { TENANT_ENDPOINTS, allowedRoles } = require("./support/registry");

// E5-07: the three transfer endpoints are in the cross-tenant registry, so the tenant harness and
// the role matrix attack them (rule 16). routeRegistry.test.js already fails for ANY route that is
// missing; this one names the transfer routes so removing an entry here cannot go unnoticed, and
// pins who may call each one.
const EXPECTED = [
  { method: "post", path: "/api/stock/transfers", action: "stock.transfer", roles: ["OWNER", "WAREHOUSE_ADMIN"] },
  { method: "get", path: "/api/stock/transfers/destinations", action: "transfer.destinations", roles: ["OWNER", "WAREHOUSE_ADMIN"] },
  { method: "get", path: "/api/stock/transfers/:id", action: "history.read", roles: ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"] },
];

describe("transfer endpoints in the tenant registry", () => {
  it.each(EXPECTED)("$method $path is registered with action $action", ({ method, path, action, roles }) => {
    const found = TENANT_ENDPOINTS.filter((entry) => entry.method === method && entry.path === path);

    expect(found).toHaveLength(1);
    expect(found[0].action).toBe(action);
    expect([...allowedRoles(found[0])].sort()).toEqual([...roles].sort());
  });
});
