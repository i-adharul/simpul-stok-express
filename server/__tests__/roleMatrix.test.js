const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { checkRoleMatrix, checkViewerWrites, checkUnassignedWarehouse } = require("./support/roleMatrix");
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
  it("reads the registry (it fills up with every tenant endpoint)", () => {
    expect(Array.isArray(TENANT_ENDPOINTS)).toBe(true);
  });

  for (const entry of TENANT_ENDPOINTS) {
    it(`${labelOf(entry)} answers each role as the permission table says`, async () => {
      expect(await checkRoleMatrix(app, entry, world)).toEqual([]);
    });
    it(`${labelOf(entry)}: a Viewer cannot write`, async () => {
      expect(await checkViewerWrites(app, entry, world)).toEqual([]);
    });
    it(`${labelOf(entry)}: a Warehouse Admin and a Viewer reach assigned warehouses only`, async () => {
      expect(await checkUnassignedWarehouse(app, entry, world)).toEqual([]);
    });
  }
});

describe("the role matrix check itself (test-only routes)", () => {
  it.each(["read", "patch", "list", "create", "receive", "detail"])("a correct %s route answers every role as expected", async (name) => {
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

describe("Viewer writes (403)", () => {
  it.each(["patch", "create", "receive"])("a correct %s route refuses a Viewer", async (name) => {
    const { app: fake, store } = buildFakeApp();

    expect(await checkViewerWrites(fake, fakeEntries(store)[name], world)).toEqual([]);
  });

  it("does not apply to a read route", async () => {
    const { app: fake, store } = buildFakeApp();

    expect(await checkViewerWrites(fake, fakeEntries(store).list, world)).toEqual([]);
  });

  it("fails when a write route lets a Viewer through", async () => {
    const { app: fake, store } = buildFakeApp({ noRoleCheck: true });

    const failures = await checkViewerWrites(fake, fakeEntries(store).create, world);

    expect(failures).toEqual([expect.stringMatching(/POST \/things: Viewer writing: expected 403 but got 201/)]);
  });
});

describe("a Warehouse Admin and a Viewer reach assigned warehouses only (403)", () => {
  it.each(["receive", "detail"])("a correct %s route holds", async (name) => {
    const { app: fake, store } = buildFakeApp();

    expect(await checkUnassignedWarehouse(fake, fakeEntries(store)[name], world)).toEqual([]);
  });

  it("does not apply to an entry that is not warehouse-scoped", async () => {
    const { app: fake, store } = buildFakeApp();

    expect(await checkUnassignedWarehouse(fake, fakeEntries(store).list, world)).toEqual([]);
  });

  it("fails when a warehouse-level action looks at the role only", async () => {
    const { app: fake, store } = buildFakeApp({ ignoresAssignment: true });

    const failures = await checkUnassignedWarehouse(fake, fakeEntries(store).receive, world);

    expect(failures).toEqual([
      expect.stringMatching(/POST \/receive: WAREHOUSE_ADMIN on a warehouse that is not assigned: expected 403 but got 201/),
    ]);
  });

  it("fails when the warehouse detail ignores the assignment", async () => {
    const { app: fake, store } = buildFakeApp({ detailIgnoresAssignment: true });

    const failures = await checkUnassignedWarehouse(fake, fakeEntries(store).detail, world);

    expect(failures).toHaveLength(2);
    expect(failures.join("\n")).toMatch(/WAREHOUSE_ADMIN on a warehouse that is not assigned/);
    expect(failures.join("\n")).toMatch(/VIEWER on a warehouse that is not assigned/);
  });
});
