const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { createOrganization, createWarehouse, assignWarehouse, createProduct } = require("./support/factories");

jest.setTimeout(30000);

let orgA;
let orgB;
let users;
const tokenOf = (key) => signToken(users[key].id);
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const patch = (id, body, key = "OWNER") => request(app).patch(`/api/members/${id}`).set("Authorization", `Bearer ${tokenOf(key)}`).send(body);
const assigned = async (userId) => (await sql('SELECT "warehouseId" FROM "UserWarehouses" WHERE "userId" = :userId', { userId })).map((r) => r.warehouseId).sort();
const receive = (key, warehouseId, productId) =>
  request(app)
    .post("/api/stock/receive")
    .set("Authorization", `Bearer ${tokenOf(key)}`)
    .set("Idempotency-Key", crypto.randomUUID())
    .send({ warehouseId, productId, quantity: 1 });

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  users = {
    OWNER: await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgA }),
    ADMIN: await createAccount({ email: "admin-a@example.com", name: "Sari Admin", role: "WAREHOUSE_ADMIN", organizationId: orgA }),
    VIEWER: await createAccount({ email: "viewer-a@example.com", name: "Andi Viewer", role: "VIEWER", organizationId: orgA }),
    PLATFORM_ADMIN: await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" }),
    OWNER_B: await createAccount({ email: "owner-b@example.com", role: "OWNER", organizationId: orgB }),
    VIEWER_B: await createAccount({ email: "viewer-b@example.com", role: "VIEWER", organizationId: orgB }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("PATCH /api/members/:id: the change applies at once", () => {
  it("a Warehouse Admin who becomes a Viewer gets 403 on the next stock write", async () => {
    const warehouseId = await createWarehouse(orgA, "GD-1");
    const productId = await createProduct(orgA);
    await assignWarehouse(orgA, users.ADMIN.id, warehouseId);
    expect((await receive("ADMIN", warehouseId, productId)).status).toBe(201);

    const res = await patch(users.ADMIN.id, { role: "VIEWER" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("VIEWER");
    const next = await receive("ADMIN", warehouseId, productId);
    expect(next.status).toBe(403);
    expect(next.body.code).toBe("FORBIDDEN");
  });

  it("a deactivated member's existing token gets 401, and their login too", async () => {
    const token = tokenOf("VIEWER");
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);

    const res = await patch(users.VIEWER.id, { isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "viewer-a@example.com", password: users.VIEWER.password })).status).toBe(401);
    expect((await readUser(users.VIEWER.id)).isActive).toBe(false);
  });

  it("answers with one row in the shape of GET /api/members", async () => {
    const w1 = await createWarehouse(orgA, "GD-1");

    const res = await patch(users.VIEWER.id, { role: "WAREHOUSE_ADMIN", warehouseIds: [w1] });

    expect(res.body).toEqual({
      id: users.VIEWER.id,
      name: "Andi Viewer",
      email: "viewer-a@example.com",
      role: "WAREHOUSE_ADMIN",
      isActive: true,
      isDemo: false,
      lastLoginAt: null,
      allWarehouses: false,
      warehouses: [{ id: w1, code: "GD-1" }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|resetToken/);
  });
});

describe("PATCH /api/members/:id: the assignment", () => {
  it("is replaced as a whole, and an empty list clears it", async () => {
    const [w1, w2, w3] = [await createWarehouse(orgA, "GD-1"), await createWarehouse(orgA, "GD-2"), await createWarehouse(orgA, "GD-3")];
    await assignWarehouse(orgA, users.VIEWER.id, w1);
    await assignWarehouse(orgA, users.VIEWER.id, w2);

    await patch(users.VIEWER.id, { warehouseIds: [w2, w3] });
    expect(await assigned(users.VIEWER.id)).toEqual([w2, w3].sort());

    const same = await patch(users.VIEWER.id, { warehouseIds: [w2, w3] });
    expect(same.status).toBe(200);
    expect(await assigned(users.VIEWER.id)).toEqual([w2, w3].sort());

    await patch(users.VIEWER.id, { warehouseIds: [] });
    expect(await assigned(users.VIEWER.id)).toEqual([]);
  });

  it("an archived warehouse, a foreign one and a random one are the same 404, and nothing changes", async () => {
    const good = await createWarehouse(orgA, "GD-1");
    const old = await createWarehouse(orgA, "GD-OLD", new Date());
    const foreign = await createWarehouse(orgB, "GD-B");
    await assignWarehouse(orgA, users.VIEWER.id, good);

    const answers = [old, foreign, "99999999-9999-4999-8999-999999999999", good].map((id) => (id === good ? [good, foreign] : [id]));
    const results = await Promise.all(answers.map((ids) => patch(users.VIEWER.id, { warehouseIds: ids })));

    for (const res of results) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(results[0].body);
    }
    expect(await assigned(users.VIEWER.id)).toEqual([good]);
  });

  it("changes the role together with the assignment in one call", async () => {
    const w1 = await createWarehouse(orgA, "GD-1");

    await patch(users.VIEWER.id, { role: "WAREHOUSE_ADMIN", warehouseIds: [w1] });

    expect((await readUser(users.VIEWER.id)).role).toBe("WAREHOUSE_ADMIN");
    expect(await assigned(users.VIEWER.id)).toEqual([w1]);
  });

  it("a failed assignment leaves the role unchanged (one transaction)", async () => {
    const res = await patch(users.VIEWER.id, { role: "WAREHOUSE_ADMIN", warehouseIds: ["99999999-9999-4999-8999-999999999999"] });

    expect(res.status).toBe(404);
    expect((await readUser(users.VIEWER.id)).role).toBe("VIEWER");
  });
});

describe("PATCH /api/members/:id: the Owner is protected", () => {
  it.each([
    ["a role change", { role: "VIEWER" }],
    ["a deactivation", { isActive: false }],
    ["an assignment", { warehouseIds: [] }],
  ])("409 for %s, and the Owner stays as they were", async (_label, body) => {
    const res = await patch(users.OWNER.id, body);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await readUser(users.OWNER.id)).toMatchObject({ role: "OWNER", isActive: true });
  });

  it("400 for the role OWNER in the body, and for isActive true", async () => {
    const asOwner = await patch(users.VIEWER.id, { role: "OWNER" });
    const reactivate = await patch(users.VIEWER.id, { isActive: true });

    expect(asOwner.status).toBe(400);
    expect(reactivate.status).toBe(400);
    expect((await readUser(users.VIEWER.id)).role).toBe("VIEWER");
  });
});

describe("PATCH /api/members/:id: whose ID it is", () => {
  it("a member of another organization, a platform admin, an unknown and a malformed ID give one identical 404", async () => {
    const results = await Promise.all(
      [users.VIEWER_B.id, users.PLATFORM_ADMIN.id, "99999999-9999-4999-8999-999999999999", "not-a-uuid"].map((id) =>
        patch(id, { role: "VIEWER" }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(results[0].body);
    }
    expect((await readUser(users.VIEWER_B.id)).isActive).toBe(true);
    expect((await readUser(users.PLATFORM_ADMIN.id)).role).toBe("PLATFORM_ADMIN");
  });

  it("organizationId, email and name in the body are rejected, so a member never moves", async () => {
    for (const body of [{ organizationId: orgB, role: "VIEWER" }, { email: "x@y.id" }, { name: "Baru" }]) {
      expect((await patch(users.VIEWER.id, body)).status).toBe(400);
    }
    expect((await readUser(users.VIEWER.id)).organizationId).toBe(orgA);
  });
});

describe("PATCH /api/members/:id: roles", () => {
  it.each(["ADMIN", "VIEWER", "PLATFORM_ADMIN"])("a %s gets 403 before the ID or body is looked at", async (key) => {
    const valid = await patch(users.VIEWER_B.id, { role: "VIEWER" }, key);
    const invalid = await patch("not-a-uuid", { role: "OWNER" }, key);

    expect(valid.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect((await readUser(users.VIEWER_B.id)).role).toBe("VIEWER");
  });

  it("no token gives 401", async () => {
    expect((await request(app).patch(`/api/members/${users.VIEWER.id}`).send({ role: "VIEWER" })).status).toBe(401);
  });
});
