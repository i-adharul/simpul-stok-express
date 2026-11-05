const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { runChecks } = require("./support/harness");

jest.setTimeout(60000);

// Runs the cross-tenant harness on every endpoint of the registry, against the real app. A story
// that adds a tenant route adds its entry to support/registry.js (docs/06_Test_Plan.md).
let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("cross-tenant harness on the real app", () => {
  it("reads the registry (it fills up with every tenant endpoint)", () => {
    expect(Array.isArray(TENANT_ENDPOINTS)).toBe(true);
  });

  for (const entry of TENANT_ENDPOINTS) {
    it(`${labelOf(entry)} holds against organization B`, async () => {
      expect(await runChecks(app, entry, world)).toEqual([]);
    });
  }
});
