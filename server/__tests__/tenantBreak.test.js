const { Op } = require("sequelize");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { runChecks } = require("./support/harness");

jest.setTimeout(120000);

// Proof that the cross-tenant checks bite on the real endpoints (E3-10, step 3). The organization
// filter of the lookup behind findOwned is removed on purpose, like a careless change to
// helpers/tenantScope.js would do, and every item endpoint of warehouses and products must then
// fail the harness. If one still passed, its tenant test would be too weak to notice a leak.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

// Unscoped lookup: keeps the caller's own condition (the first of the AND) and drops organizationId.
const withoutOrganizationFilter = (original) =>
  function (options) {
    const [own] = options.where[Op.and];
    return original.call(this, { ...options, where: own });
  };

const ITEM_ENDPOINTS = TENANT_ENDPOINTS.filter(
  (entry) => entry.kind === "item" && /^\/api\/(warehouses|products)\/:id$/.test(entry.path),
);

describe("a findOwned without the organization filter is caught by the tenant harness", () => {
  it("covers the item endpoints of warehouses and products", () => {
    expect(ITEM_ENDPOINTS.map(labelOf).sort()).toEqual([
      "GET /warehouses/:id",
      "PATCH /warehouses/:id",
      "GET /products/:id",
      "PATCH /products/:id",
    ].sort());
  });

  it.each(ITEM_ENDPOINTS.map((entry) => [labelOf(entry), entry]))("%s fails the harness", async (_label, entry) => {
    const spies = [db.Warehouse, db.Product].map((Model) => {
      const original = Model.findOne; // taken before the spy replaces it
      return jest.spyOn(Model, "findOne").mockImplementation(withoutOrganizationFilter(original));
    });

    const failures = await runChecks(app, entry, world);
    spies.forEach((spy) => spy.mockRestore());

    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toMatch(/B's id: expected 404 but got (200|403)/);
  });

  it("the same endpoints pass again once the filter is back", async () => {
    for (const entry of ITEM_ENDPOINTS) expect(await runChecks(app, entry, world)).toEqual([]);
  });
});
