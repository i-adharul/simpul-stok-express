const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, createWarehouse, assignWarehouse, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(30000);

let orgA;
let orgB;
let users;
const as = (key) => `Bearer ${signToken(users[key].id)}`;
const list = (query = "", key = "OWNER") => request(app).get(`/api/members${query}`).set("Authorization", as(key));

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  await giveRoomyPlan(orgA, orgB);
  users = {
    OWNER: await createAccount({ email: "owner-a@example.com", name: "Zahra Owner", role: "OWNER", organizationId: orgA }),
    WAREHOUSE_ADMIN: await createAccount({ email: "admin-a@example.com", name: "Sari Admin", role: "WAREHOUSE_ADMIN", organizationId: orgA }),
    VIEWER: await createAccount({ email: "viewer-a@example.com", name: "Andi Viewer", role: "VIEWER", organizationId: orgA }),
    PLATFORM_ADMIN: await createAccount({ email: "platform@example.com", name: "Platform", role: "PLATFORM_ADMIN" }),
    OWNER_B: await createAccount({ email: "owner-b@example.com", name: "Budi B", role: "OWNER", organizationId: orgB }),
    VIEWER_B: await createAccount({ email: "viewer-b@example.com", name: "Cici B", role: "VIEWER", organizationId: orgB }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("GET /api/members", () => {
  it("lists the organization's users: Owner first, then by name, inactive ones included", async () => {
    await createAccount({ email: "gone@example.com", name: "Bima Nonaktif", role: "VIEWER", organizationId: orgA, isActive: false });

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 4, page: 1, pageSize: 20 });
    expect(res.body.items.map((m) => [m.name, m.role, m.isActive])).toEqual([
      ["Zahra Owner", "OWNER", true],
      ["Andi Viewer", "VIEWER", true],
      ["Bima Nonaktif", "VIEWER", false],
      ["Sari Admin", "WAREHOUSE_ADMIN", true],
    ]);
  });

  it("has exactly the documented fields and never a secret column", async () => {
    const res = await list();

    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["allWarehouses", "email", "id", "isActive", "lastLoginAt", "name", "role", "warehouses"].sort(),
      );
    }
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|resetToken|resetExpires|\$2[aby]\$/);
  });

  it("never shows a user of another organization or a platform admin", async () => {
    const res = await list();

    const ids = res.body.items.map((m) => m.id);
    expect(ids).not.toContain(users.OWNER_B.id);
    expect(ids).not.toContain(users.VIEWER_B.id);
    expect(ids).not.toContain(users.PLATFORM_ADMIN.id);
    expect(JSON.stringify(res.body)).not.toMatch(/owner-b|viewer-b|platform@/);
  });

  it("shows the assigned ACTIVE warehouses (id and code); the Owner has allWarehouses", async () => {
    const w2 = await createWarehouse(orgA, "GD-2");
    const w1 = await createWarehouse(orgA, "GD-1");
    const old = await createWarehouse(orgA, "GD-OLD", new Date());
    const foreign = await createWarehouse(orgB, "GD-B");
    for (const w of [w2, w1, old]) await assignWarehouse(orgA, users.WAREHOUSE_ADMIN.id, w);
    // A link row that points at another organization's warehouse must never show it (defence in depth).
    await getSequelize().query(
      'INSERT INTO "UserWarehouses" ("organizationId","userId","warehouseId") VALUES (:orgB,:userId,:foreign)',
      { replacements: { orgB, userId: users.VIEWER_B.id, foreign } },
    );

    const res = await list();

    const by = (key) => res.body.items.find((m) => m.id === users[key].id);
    expect(by("OWNER")).toMatchObject({ allWarehouses: true, warehouses: [] });
    expect(by("WAREHOUSE_ADMIN")).toMatchObject({
      allWarehouses: false,
      warehouses: [{ id: w1, code: "GD-1" }, { id: w2, code: "GD-2" }],
    });
    expect(by("VIEWER")).toMatchObject({ allWarehouses: false, warehouses: [] });
    expect(JSON.stringify(res.body)).not.toContain(foreign);
  });

  it("pages with a total", async () => {
    const res = await list("?page=2&pageSize=2");

    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.body.items.map((m) => m.name)).toEqual(["Sari Admin"]);
  });

  it("400 for bad paging and unknown query keys", async () => {
    expect((await list("?pageSize=101")).status).toBe(400);
    expect((await list("?includeArchived=true")).status).toBe(400);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER", "PLATFORM_ADMIN"])("answers a %s 403, before the query is read", async (key) => {
    const res = await list("?pageSize=999", key);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("answers no token 401", async () => {
    expect((await request(app).get("/api/members")).status).toBe(401);
  });
});
