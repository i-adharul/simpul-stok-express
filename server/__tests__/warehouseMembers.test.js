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
