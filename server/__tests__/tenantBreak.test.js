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

// Item endpoints whose only tenant guard is the lookup behind findOwned: the warehouse and product
// endpoints, and the two warehouse assignment endpoints (the warehouse in the URL is the item).
const BREAKABLE = /^\/api\/(warehouses|products)\/:id(\/members)?$/;
const ITEM_ENDPOINTS = TENANT_ENDPOINTS.filter((entry) => entry.kind === "item" && BREAKABLE.test(entry.path));
// The movement detail has a second guard: even a movement of another organization that was found
// is refused because its warehouse is not in ctx.warehouseIds. Two layers, so it must keep holding
// when the organization filter alone is removed.
const MOVEMENT_ITEM = TENANT_ENDPOINTS.find((entry) => entry.path === "/api/stock/movements/:id");

describe("a findOwned without the organization filter is caught by the tenant harness", () => {
  it("covers the item endpoints of warehouses and products", () => {
    expect(ITEM_ENDPOINTS.map(labelOf).sort()).toEqual([
      "GET /warehouses/:id",
      "PATCH /warehouses/:id",
      "GET /warehouses/:id/members",
      "PUT /warehouses/:id/members",
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

  it("the movement detail still holds without the organization filter (its warehouse check is a second layer)", async () => {
    const original = db.StockMovement.findOne;
    const spy = jest.spyOn(db.StockMovement, "findOne").mockImplementation(withoutOrganizationFilter(original));

    const failures = await runChecks(app, MOVEMENT_ITEM, world);
    spy.mockRestore();

    expect(failures).toEqual([]);
  });

  it("the same endpoints pass again once the filter is back", async () => {
    for (const entry of [...ITEM_ENDPOINTS, MOVEMENT_ITEM]) expect(await runChecks(app, entry, world)).toEqual([]);
  });
});
