const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createWarehouse, assignWarehouse, createUser } = require("./support/factories");

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
const as = (role, org = "A") => world.users[org][role].authorization;
const get = (url, role = "OWNER") => request(app).get(url).set("Authorization", as(role));
const archivedWarehouse = (code, org = orgA()) => createWarehouse(org, code, new Date());
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];

describe("GET /api/warehouses", () => {
  it("lists the active warehouses of the Owner's organization, ordered by code, with the documented fields", async () => {
    await world.createWarehouse("A", "GD-B");
    await world.createWarehouse("A", "GD-A");
    await world.createWarehouse("B", "GD-X");
    await archivedWarehouse("GD-OLD");

    const res = await get("/api/warehouses");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.items.map((w) => w.code)).toEqual(["GD-A", "GD-B"]);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ["address", "archivedAt", "code", "createdAt", "id", "name", "organizationId", "updatedAt"],
    );
    expect(res.body.items[0].organizationId).toBe(orgA());
  });

  it("orders the list by code, whatever the order of creation", async () => {
    for (const code of ["C", "A", "B"]) await world.createWarehouse("A", code);

    const res = await get("/api/warehouses");

    expect(res.body.items.map((w) => w.code)).toEqual(["A", "B", "C"]);
  });

  it("shows archived warehouses to the Owner only when includeArchived=true", async () => {
    await world.createWarehouse("A", "GD-1");
    await archivedWarehouse("GD-OLD");

    const res = await get("/api/warehouses?includeArchived=true");

    expect(res.body.items.map((w) => w.code)).toEqual(["GD-1", "GD-OLD"]);
    expect(res.body.total).toBe(2);
    expect(res.body.items[1].archivedAt).not.toBeNull();
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("%s sees only the assigned active warehouses", async (role) => {
    const mine = await world.createWarehouse("A", "GD-MINE");
    await world.createWarehouse("A", "GD-OTHER");
    const oldOne = await archivedWarehouse("GD-OLD");
    await assignWarehouse(orgA(), world.users.A[role].id, mine);
    await assignWarehouse(orgA(), world.users.A[role].id, oldOne);

    const res = await get("/api/warehouses?includeArchived=true", role);

    expect(res.status).toBe(200);
    expect(res.body.items.map((w) => w.code)).toEqual(["GD-MINE"]);
    expect(res.body.total).toBe(1);
  });

  it("is empty for a Warehouse Admin without assignments", async () => {
    await world.createWarehouse("A");

    const res = await get("/api/warehouses", "WAREHOUSE_ADMIN");

    expect(res.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it("pages the list: page, pageSize and the total of all rows", async () => {
    for (const code of ["A", "B", "C", "D", "E"]) await world.createWarehouse("A", code);

    const second = await get("/api/warehouses?page=2&pageSize=2");
    const beyond = await get("/api/warehouses?page=9&pageSize=2");

    expect(second.body.items.map((w) => w.code)).toEqual(["C", "D"]);
    expect(second.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(beyond.body).toMatchObject({ items: [], total: 5 });
  });

  it.each([
    "page=0",
    "page=-2",
    "page=abc",
    "pageSize=0",
    "pageSize=101",
    "includeArchived=yes",
    "organizationId=00000000-0000-4000-8000-000000000000",
  ])("answers 400 VALIDATION_ERROR for ?%s", async (query) => {
    const res = await get(`/api/warehouses?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].source).toBe("query");
  });

  it("accepts pageSize 100", async () => {
    expect((await get("/api/warehouses?pageSize=100")).status).toBe(200);
  });
});

describe("GET /api/warehouses/:id", () => {
  it("returns the warehouse with its active assigned users, sorted by name, without email", async () => {
    const id = await world.createWarehouse("A", "GD-1");
    const zed = await createUser(orgA(), "zed@example.com", "VIEWER");
    const ana = await createUser(orgA(), "ana@example.com", "WAREHOUSE_ADMIN");
    const gone = await createUser(orgA(), "gone@example.com", "VIEWER");
    await sql(`UPDATE "Users" SET "name" = 'Zed' WHERE "id" = :zed`, { zed });
    await sql(`UPDATE "Users" SET "name" = 'Ana' WHERE "id" = :ana`, { ana });
    await sql(`UPDATE "Users" SET "isActive" = false WHERE "id" = :gone`, { gone });
    for (const userId of [zed, ana, gone]) await assignWarehouse(orgA(), userId, id);

    const res = await get(`/api/warehouses/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, code: "GD-1", archivedAt: null });
    expect(res.body.assignedUsers).toEqual([
      { id: ana, name: "Ana", role: "WAREHOUSE_ADMIN" },
      { id: zed, name: "Zed", role: "VIEWER" },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|email/);
  });

  it("has an empty assignedUsers list when nobody is assigned", async () => {
    const id = await world.createWarehouse("A");

    expect((await get(`/api/warehouses/${id}`)).body.assignedUsers).toEqual([]);
  });

  it("never shows a user of another organization, even when an assignment row points at one", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.B.VIEWER.id, id);
    await assignWarehouse(world.organizations.B, world.users.B.OWNER.id, id);

    const res = await get(`/api/warehouses/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.assignedUsers).toEqual([]);
    expect(res.text).not.toContain(world.users.B.VIEWER.id);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("lets a %s read an assigned warehouse", async (role) => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.A[role].id, id);

    const res = await get(`/api/warehouses/${id}`, role);

    expect(res.status).toBe(200);
    expect(res.body.assignedUsers.map((u) => u.id)).toEqual([world.users.A[role].id]);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s for a warehouse that is not assigned", async (role) => {
    const id = await world.createWarehouse("A");

    const res = await get(`/api/warehouses/${id}`, role);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("answers the same 404 for a missing ID, a malformed ID and another organization's warehouse", async () => {
    const foreign = await world.createWarehouse("B");

    const answers = [
      await get(`/api/warehouses/${foreign}`),
      await get("/api/warehouses/33333333-3333-4333-8333-333333333333"),
      await get("/api/warehouses/not-a-uuid"),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
    expect(answers[0].body.code).toBe("NOT_FOUND");
  });

  it("shows an archived warehouse to the Owner but answers 404 to everyone else", async () => {
    const id = await archivedWarehouse("GD-OLD");
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, id);

    expect((await get(`/api/warehouses/${id}`)).status).toBe(200);
    expect((await get(`/api/warehouses/${id}`, "WAREHOUSE_ADMIN")).status).toBe(404);
    expect((await get(`/api/warehouses/${id}`, "VIEWER")).status).toBe(404);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    const id = await world.createWarehouse("A");

    expect((await request(app).get(`/api/warehouses/${id}`)).status).toBe(401);
    const admin = await request(app).get(`/api/warehouses/${id}`).set("Authorization", world.platformAdmin.authorization);
    expect(admin.status).toBe(403);
  });
});
