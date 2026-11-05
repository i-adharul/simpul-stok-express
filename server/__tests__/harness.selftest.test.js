const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { buildFakeApp, fakeEntries } = require("./support/fakeTenantApp");
const { runChecks, CHECKS, checkNoToken, checkPlatformAdmin, checkRoleWithoutRight } = require("./support/harness");

jest.setTimeout(60000);

// The harness is proven here: a correct test route passes every check, and a route with one
// deliberate flaw fails the matching check, with a message that says what went wrong.
let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const attack = (flaws, entryName, check) => {
  const { app, store } = buildFakeApp(flaws);
  return check(app, fakeEntries(store)[entryName], world);
};

describe("a correctly scoped route passes the checks of part 1", () => {
  it.each(["read", "patch", "list"])("%s", async (entryName) => {
    const { app, store } = buildFakeApp();

    const failures = await runChecks(app, fakeEntries(store)[entryName], world, CHECKS);

    expect(failures).toEqual([]);
  });
});

describe("part 1: authentication and roles", () => {
  it("noToken fails for a route that forgot authentication", async () => {
    const failures = await attack({ noAuthentication: true }, "read", checkNoToken);

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toMatch(/GET \/things\/:id: no token: expected 401 but got/);
  });

  it("platformAdmin fails for a route that forgot the role check", async () => {
    const failures = await attack({ noRoleCheck: true }, "patch", checkPlatformAdmin);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/PATCH \/things\/:id: Platform admin: expected 403 but got/);
  });

  it("roleWithoutRight fails for a write route without a role check, naming the role", async () => {
    const failures = await attack({ noRoleCheck: true }, "patch", checkRoleWithoutRight);

    // WAREHOUSE_ADMIN and VIEWER x (B's id, a random id, its own org's id) = 6 failures.
    expect(failures).toHaveLength(6);
    expect(failures.join("\n")).toMatch(/WAREHOUSE_ADMIN \(not allowed\)/);
    expect(failures.join("\n")).toMatch(/VIEWER \(not allowed\)/);
  });

  it("roleWithoutRight has nothing to check on a read route every tenant role may call", async () => {
    const failures = await attack({ noRoleCheck: true }, "read", checkRoleWithoutRight);

    expect(failures).toEqual([]);
  });
});
