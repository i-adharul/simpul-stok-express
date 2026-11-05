const { ACTIONS } = require("../helpers/permissions");
const { TENANT_ENDPOINTS, labelOf, allowedRoles, validateEntry } = require("./support/registry");
const { EXEMPT_ROUTES, PUBLIC_ROUTES } = require("./support/exemptions");

const valid = (extra = {}) => ({
  method: "get",
  path: "/api/things/:id",
  kind: "item",
  action: "warehouse.read",
  createRow: async () => ({ id: "x" }),
  readRow: async () => null,
  ...extra,
});

describe("the registry as written", () => {
  it("has only valid entries", () => {
    for (const entry of TENANT_ENDPOINTS) {
      expect({ entry: labelOf(entry), problems: validateEntry(entry) }).toEqual({ entry: labelOf(entry), problems: [] });
    }
  });

  it("has one entry per method and path (labels are unique)", () => {
    const labels = TENANT_ENDPOINTS.map(labelOf);

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the exemption lists", () => {
  it.each([["EXEMPT_ROUTES", EXEMPT_ROUTES], ["PUBLIC_ROUTES", PUBLIC_ROUTES]])(
    "%s: every label has a written reason",
    (_name, list) => {
      for (const [label, reason] of Object.entries(list)) {
        expect(label).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \//);
        expect(typeof reason).toBe("string");
        expect(reason.trim().length).toBeGreaterThan(10);
      }
    },
  );

  it("never lists the same route in both", () => {
    const both = Object.keys(EXEMPT_ROUTES).filter((label) => label in PUBLIC_ROUTES);

    expect(both).toEqual([]);
  });
});

describe("validateEntry", () => {
  it("accepts a correct item entry, list entry and create entry", () => {
    expect(validateEntry(valid())).toEqual([]);
    expect(validateEntry(valid({ kind: "list", path: "/api/things", supportsCursor: true }))).toEqual([]);
    expect(
      validateEntry(valid({ kind: "create", method: "post", path: "/api/things", countRows: async () => 0, idempotent: true })),
    ).toEqual([]);
  });

  it.each([
    [{ method: "head" }, /method/],
    [{ path: "/things/:id" }, /path must start/],
    [{ kind: "page" }, /kind/],
    [{ action: "stock.delete" }, /action/],
    [{ createRow: undefined }, /createRow/],
    [{ readRow: undefined }, /readRow/],
    [{ path: "/api/things" }, /item entry needs/],
    [{ kind: "list", method: "get" }, /only an item entry may have/],
    [{ kind: "list", path: "/api/things", method: "post" }, /list entry must use get/],
    [{ kind: "create", path: "/api/things", method: "get", countRows: async () => 0 }, /create entry must use post/],
    [{ method: "post" }, /cannot use post/],
    [{ supportsCursor: true }, /supportsCursor/],
    [{ kind: "create", method: "post", path: "/api/things" }, /countRows/],
    [{ method: "get", idempotent: true, countRows: async () => 0 }, /cannot be idempotent/],
    [{ foreignBodies: [{ key: "warehouseId" }] }, /foreignBodies/],
  ])("rejects %p", (extra, message) => {
    expect(validateEntry(valid(extra)).join(" | ")).toMatch(message);
  });

  it("reports every fault at once", () => {
    expect(validateEntry({ method: "head" }).length).toBeGreaterThan(3);
  });
});

describe("labelOf and allowedRoles", () => {
  it("labels an entry like the route inspector does (no /api prefix)", () => {
    expect(labelOf(valid())).toBe("GET /things/:id");
    expect(labelOf(valid({ method: "patch" }))).toBe("PATCH /things/:id");
  });

  it("derives the allowed tenant roles from the permission matrix", () => {
    expect(allowedRoles(valid({ action: "warehouse.manage" }))).toEqual(["OWNER"]);
    expect(allowedRoles(valid({ action: "stock.receive" }))).toEqual(["OWNER", "WAREHOUSE_ADMIN"]);
    expect(allowedRoles(valid({ action: "warehouse.read" }))).toEqual(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]);
  });

  it("never allows a Platform admin on any action", () => {
    for (const action of Object.keys(ACTIONS)) {
      expect(allowedRoles(valid({ action }))).not.toContain("PLATFORM_ADMIN");
    }
  });
});
