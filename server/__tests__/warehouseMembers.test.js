const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createWarehouse, assignWarehouse } = require("./support/factories");
const { createAccount } = require("./support/accounts");
const { signToken } = require("../helpers/jwt");

jest.setTimeout(60000);

let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const orgA = () => world.organizations.A;
const as = (role) => world.users.A[role].authorization;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const members = (id, role = "OWNER") => request(app).get(`/api/warehouses/${id}/members`).set("Authorization", as(role));
const put = (id, body, role = "OWNER") => request(app).put(`/api/warehouses/${id}/members`).set("Authorization", as(role)).send(body);
const assigned = async (warehouseId) =>
  (await sql(`SELECT "userId" FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId ORDER BY "userId"`, { warehouseId })).map((r) => r.userId);
const archivedWarehouse = (org = orgA()) => createWarehouse(org, "GD-OLD", new Date());
// Extra users of organization A (the world already has one Warehouse Admin and one Viewer).
const newUser = async (name, role, extra = {}) =>
  createAccount({ email: `${name.toLowerCase().replace(/\W/g, "")}@example.com`, name, role, organizationId: orgA(), ...extra });

describe("GET /api/warehouses/:id/members", () => {
  it("lists active Warehouse Admins and Viewers sorted by name, with the assigned flag", async () => {
    const id = await world.createWarehouse("A");
    const zed = await newUser("Zed", "VIEWER");
    const ana = await newUser("Ana", "WAREHOUSE_ADMIN");
    await assignWarehouse(orgA(), ana.id, id);

    const res = await members(id);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.candidates.map((c) => c.name)).toEqual(["Ana", "VIEWER A", "WAREHOUSE_ADMIN A", "Zed"]);
    expect(res.body.candidates.find((c) => c.id === ana.id)).toEqual({
      id: ana.id,
      name: "Ana",
      email: ana.email,
      role: "WAREHOUSE_ADMIN",
      assigned: true,
    });
    expect(res.body.candidates.find((c) => c.id === zed.id).assigned).toBe(false);
  });

  it("never lists the Owner, a platform admin, an inactive user or a user of another organization", async () => {
    const id = await world.createWarehouse("A");
    const inactive = await newUser("Inactive", "VIEWER", { isActive: false });

    const res = await members(id);

    const ids = res.body.candidates.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([world.users.A.WAREHOUSE_ADMIN.id, world.users.A.VIEWER.id]));
    for (const hidden of [world.users.A.OWNER.id, world.platformAdmin.id, inactive.id, world.users.B.VIEWER.id, world.users.B.WAREHOUSE_ADMIN.id]) {
      expect(ids).not.toContain(hidden);
    }
    expect(ids).toHaveLength(2);
  });

  it("marks only the assignments of this warehouse", async () => {
    const id = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, other);

    const res = await members(id);

    expect(res.body.candidates.every((c) => c.assigned === false)).toBe(true);
  });

  it("answers the same 404 for a missing, malformed, foreign and archived warehouse", async () => {
    const answers = [
      await members("33333333-3333-4333-8333-333333333333"),
      await members("not-a-uuid"),
      await members(await world.createWarehouse("B")),
      await members(await archivedWarehouse()),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s before anything else, also for an unknown warehouse", async (role) => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.A[role].id, id);

    expect((await members(id, role)).status).toBe(403);
    expect((await members("33333333-3333-4333-8333-333333333333", role)).status).toBe(403);
    expect((await members(await world.createWarehouse("B"), role)).status).toBe(403);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    const id = await world.createWarehouse("A");

    expect((await request(app).get(`/api/warehouses/${id}/members`)).status).toBe(401);
    const admin = await request(app).get(`/api/warehouses/${id}/members`).set("Authorization", world.platformAdmin.authorization);
    expect(admin.status).toBe(403);
  });
});

describe("PUT /api/warehouses/:id/members", () => {
  const RANDOM = "33333333-3333-4333-8333-333333333333";
  const assignedFlags = (res) => Object.fromEntries(res.body.candidates.map((c) => [c.id, c.assigned]));
  const wa = () => world.users.A.WAREHOUSE_ADMIN.id;
  const viewer = () => world.users.A.VIEWER.id;

  it("replaces the whole assignment and answers with the same shape as the GET", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);

    const res = await put(id, { userIds: [viewer()] });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(assignedFlags(res)).toEqual({ [wa()]: false, [viewer()]: true });
    expect(await assigned(id)).toEqual([viewer()]);
    expect(res.body).toEqual((await members(id)).body);
    const [row] = await sql(`SELECT "organizationId" FROM "UserWarehouses" WHERE "warehouseId" = :id`, { id });
    expect(row.organizationId).toBe(orgA());
  });

  it("gives the same result when the request is repeated", async () => {
    const id = await world.createWarehouse("A");

    const first = await put(id, { userIds: [wa(), viewer()] });
    const second = await put(id, { userIds: [viewer(), wa()] });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await assigned(id)).toHaveLength(2);
  });

  it("removes every assignment with an empty list, and only for this warehouse", async () => {
    const id = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);
    await assignWarehouse(orgA(), viewer(), id);
    await assignWarehouse(orgA(), wa(), other);

    const res = await put(id, { userIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.candidates.every((c) => c.assigned === false)).toBe(true);
    expect(await assigned(id)).toEqual([]);
    expect(await assigned(other)).toEqual([wa()]);
  });

  it("drives the warehouses a Warehouse Admin can reach (ctx.warehouseIds); the Owner always reaches all", async () => {
    const id = await world.createWarehouse("A");
    const list = async (role) => (await request(app).get("/api/warehouses").set("Authorization", as(role))).body.items.map((w) => w.id);
    expect(await list("WAREHOUSE_ADMIN")).toEqual([]);

    await put(id, { userIds: [wa()] });
    expect(await list("WAREHOUSE_ADMIN")).toEqual([id]);
    expect(await list("VIEWER")).toEqual([]);
    expect((await request(app).get(`/api/warehouses/${id}`).set("Authorization", as("WAREHOUSE_ADMIN"))).status).toBe(200);

    await put(id, { userIds: [] });
    expect(await list("WAREHOUSE_ADMIN")).toEqual([]);
    expect((await request(app).get(`/api/warehouses/${id}`).set("Authorization", as("WAREHOUSE_ADMIN"))).status).toBe(403);
    expect(await list("OWNER")).toEqual([id]);
  });

  it("accepts user IDs written in capital letters", async () => {
    const id = await world.createWarehouse("A");

    const res = await put(id, { userIds: [wa().toUpperCase()] });

    expect(res.status).toBe(200);
    expect(await assigned(id)).toEqual([wa()]);
  });

  it.each([
    ["a missing userIds", {}],
    ["userIds that is not an array", { userIds: RANDOM }],
    ["an item that is not a string", { userIds: [5] }],
    ["a malformed ID", { userIds: ["not-a-uuid"] }],
    ["a duplicate ID", { userIds: [RANDOM, RANDOM] }],
    ["an unknown field", { userIds: [], organizationId: RANDOM }],
  ])("answers 400 for %s and leaves the assignment alone", async (_what, body) => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);

    const res = await put(id, body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(await assigned(id)).toEqual([wa()]);
  });

  it("answers 400 for a duplicate that differs only in letter case", async () => {
    const id = await world.createWarehouse("A");

    const res = await put(id, { userIds: [wa(), wa().toUpperCase()] });

    expect(res.status).toBe(400);
  });

  it("answers 400 for more than 200 IDs, and does not reject exactly 200 for being many", async () => {
    const id = await world.createWarehouse("A");
    const uuids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    expect((await put(id, { userIds: uuids(201) })).status).toBe(400);
    // 200 unknown users: the size is fine, the users are not there (404).
    expect((await put(id, { userIds: uuids(200) })).status).toBe(404);
  });

  it("answers 400 for an Owner, an inactive user, and leaves the assignment alone", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);
    const inactive = await newUser("Inactive", "VIEWER", { isActive: false });

    for (const userId of [world.users.A.OWNER.id, inactive.id]) {
      const res = await put(id, { userIds: [viewer(), userId] });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual([{ source: "body", path: "userIds", message: "Ada pengguna yang tidak dapat ditugaskan." }]);
    }
    expect(await assigned(id)).toEqual([wa()]);
  });

  it("answers one and the same 404 for a missing user and a user of another organization, and writes nothing", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);

    const missing = await put(id, { userIds: [viewer(), RANDOM] });
    const foreign = await put(id, { userIds: [viewer(), world.users.B.VIEWER.id] });

    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(missing.text);
    expect(await assigned(id)).toEqual([wa()]);
    const [{ n }] = await sql(`SELECT count(*) AS n FROM "UserWarehouses" WHERE "organizationId" = :b`, { b: world.organizations.B });
    expect(Number(n)).toBe(0);
  });

  it("answers the same 404 for a missing, malformed, foreign and archived warehouse", async () => {
    const answers = [
      await put(RANDOM, { userIds: [] }),
      await put("not-a-uuid", { userIds: [] }),
      await put(await world.createWarehouse("B"), { userIds: [] }),
      await put(await archivedWarehouse(), { userIds: [] }),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s before the body or the ID is looked at", async (role) => {
    const id = await world.createWarehouse("A");

    expect((await put(id, { userIds: [viewer()] }, role)).status).toBe(403);
    expect((await put(RANDOM, { nonsense: 1 }, role)).status).toBe(403);
    expect(await assigned(id)).toEqual([]);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    const id = await world.createWarehouse("A");

    expect((await request(app).put(`/api/warehouses/${id}/members`).send({ userIds: [] })).status).toBe(401);
    const admin = await request(app)
      .put(`/api/warehouses/${id}/members`)
      .set("Authorization", world.platformAdmin.authorization)
      .send({ userIds: [] });
    expect(admin.status).toBe(403);
  });
});

describe("PUT /api/warehouses/:id/members is one transaction", () => {
  const wa = () => world.users.A.WAREHOUSE_ADMIN.id;
  const viewer = () => world.users.A.VIEWER.id;

  it("rolls back the deletes when an insert fails halfway", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), wa(), id);
    const extra = await newUser("Extra", "VIEWER");
    let calls = 0;
    const real = db.UserWarehouse.create.bind(db.UserWarehouse);
    const spy = jest.spyOn(db.UserWarehouse, "create").mockImplementation((...args) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    });

    const res = await put(id, { userIds: [viewer(), extra.id] });
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(await assigned(id)).toEqual([wa()]);
  });

  it("serializes simultaneous replacements: all succeed and the end state is one of the requested sets", async () => {
    const id = await world.createWarehouse("A");
    const sets = [[wa()], [viewer()], [wa(), viewer()], []];

    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => put(id, { userIds: sets[i % sets.length] })));

    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    const end = await assigned(id);
    expect(sets.map((set) => [...set].sort())).toContainEqual(end);
  });
});
