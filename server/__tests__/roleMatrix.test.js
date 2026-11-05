const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { checkRoleMatrix } = require("./support/roleMatrix");
const { buildFakeApp, fakeEntries } = require("./support/fakeTenantApp");

jest.setTimeout(60000);

let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("role matrix on every endpoint of the registry (real app)", () => {
  it("reads the registry (it fills up from E3-01 on)", () => {
    expect(Array.isArray(TENANT_ENDPOINTS)).toBe(true);
  });

  for (const entry of TENANT_ENDPOINTS) {
    it(`${labelOf(entry)} answers each role as the permission table says`, async () => {
      expect(await checkRoleMatrix(app, entry, world)).toEqual([]);
    });
  }
});

describe("the role matrix check itself (test-only routes)", () => {
  it.each(["read", "patch", "list", "create"])("a correct %s route answers every role as expected", async (name) => {
    const { app: fake, store } = buildFakeApp();

    expect(await checkRoleMatrix(fake, fakeEntries(store)[name], world)).toEqual([]);
  });

  it("fails when a route lets a role in that the matrix denies, naming the role and the action", async () => {
    const { app: fake, store } = buildFakeApp({ noRoleCheck: true });

    const failures = await checkRoleMatrix(fake, fakeEntries(store).patch, world);

    expect(failures.join("\n")).toMatch(/WAREHOUSE_ADMIN \(the matrix denies warehouse\.manage\): expected 403/);
    expect(failures.join("\n")).toMatch(/VIEWER \(the matrix denies warehouse\.manage\): expected 403/);
    expect(failures.join("\n")).toMatch(/Platform admin: expected 403/);
  });

  it("fails when a route refuses a role the matrix allows", async () => {
    const { app: fake, store } = buildFakeApp({ refusesViewerRead: true });

    const failures = await checkRoleMatrix(fake, fakeEntries(store).list, world);

    expect(failures).toEqual([expect.stringMatching(/VIEWER \(the matrix allows warehouse\.read\): refused with 403/)]);
  });
});
