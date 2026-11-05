const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { buildFakeApp, fakeEntries } = require("./support/fakeTenantApp");
const {
  runChecks,
  CHECKS,
  checkNoToken,
  checkPlatformAdmin,
  checkRoleWithoutRight,
  checkForeignItem,
  checkList,
  checkCursor,
  checkOrganizationIdInput,
  checkForeignBodies,
} = require("./support/harness");

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

describe("a correctly scoped route passes every check", () => {
  it.each(["read", "patch", "list", "create"])("%s", async (entryName) => {
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

describe("part 2: B's data from A's session", () => {
  it("foreignItem fails when B's row is answered 403 instead of 404", async () => {
    const failures = await attack({ foreign403: true }, "read", checkForeignItem);

    expect(failures.join("\n")).toMatch(/GET \/things\/:id: B's id: expected 404 but got 403/);
    expect(failures.join("\n")).toMatch(/not answered byte-identically/);
  });

  it("foreignItem fails when the 404 for B's row has another message than for a missing row", async () => {
    const failures = await attack({ foreignMessage: true }, "read", checkForeignItem);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/B's id is not answered byte-identically to a missing id/);
  });

  it("foreignItem fails when an update touches B's row and then answers 404", async () => {
    const failures = await attack({ updatesForeign: true }, "patch", checkForeignItem);

    expect(failures).toEqual([expect.stringMatching(/PATCH \/things\/:id: B's row was changed or removed from A's session/)]);
  });

  it("list fails when the list contains B's rows", async () => {
    const failures = await attack({ listLeaks: true }, "list", checkList);

    expect(failures).toEqual([expect.stringMatching(/GET \/things: the list contains a row of B/)]);
  });

  it("cursor fails when a cursor holding B's id returns B's rows", async () => {
    const failures = await attack({ cursorLeaks: true }, "list", checkCursor);

    expect(failures.join("\n")).toMatch(/a cursor holding B's id returned a row of B/);
  });

  it("organizationId check fails when the query is believed (B's rows are shown)", async () => {
    const failures = await attack({ trustsQueryOrg: true }, "list", checkOrganizationIdInput);

    expect(failures).toEqual([expect.stringMatching(/organizationId in the query or body showed a row of B/)]);
  });

  it("organizationId check fails when the body is believed on create (a row appears in B)", async () => {
    const failures = await attack({ trustsBodyOrg: true }, "create", checkOrganizationIdInput);

    expect(failures).toEqual([expect.stringMatching(/POST \/things: organizationId in the query or body created a row in B/)]);
  });

  it("organizationId check fails when the body moves A's row to B on update", async () => {
    const failures = await attack({ patchMovesRow: true }, "patch", checkOrganizationIdInput);

    expect(failures.join("\n")).toMatch(/organizationId in the body moved A's row to B/);
  });

  it("foreignBodies fails when a foreign parent id is accepted", async () => {
    const failures = await attack({ parentLeak: true }, "create", checkForeignBodies);

    expect(failures.join("\n")).toMatch(/parentId: B's id was not refused \(status 201\)/);
    expect(failures.join("\n")).toMatch(/parentId: B's id is not answered byte-identically to a random id/);
    expect(failures.join("\n")).toMatch(/parentId: a refused request still wrote a row|not refused/);
  });

  it("the checks that do not apply to an entry return nothing", async () => {
    const { app, store } = buildFakeApp({ listLeaks: true, foreign403: true });
    const entries = fakeEntries(store);

    expect(await checkList(app, entries.read, world)).toEqual([]);
    expect(await checkForeignItem(app, entries.list, world)).toEqual([]);
    expect(await checkCursor(app, entries.read, world)).toEqual([]);
    expect(await checkForeignBodies(app, entries.read, world)).toEqual([]);
  });
});
