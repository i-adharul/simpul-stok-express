const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel, assignWarehouse } = require("./support/factories");

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

const as = (role, org = "A") => world.users[org][role].authorization;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";

const detail = (id, role = "OWNER", org = "A") => request(app).get(`/api/stock/transfers/${id}`).set("Authorization", as(role, org));

// A real transfer made through the endpoint, so the detail shows what the write stored: two
// products (the second named with an accent and a unit), stock in the source, a note.
async function makeTransfer({ org = "A", role = "OWNER" } = {}) {
  const organizationId = world.organizations[org];
  const fromWarehouseId = await world.createWarehouse(org, "SRC");
  const toWarehouseId = await world.createWarehouse(org, "DST");
  const first = await world.createProduct(org, "SKU-AAA");
  const second = await world.createProduct(org, "SKU-BBB");
  for (const productId of [first, second]) await createStockLevel(organizationId, fromWarehouseId, productId, 10);
  const res = await request(app)
    .post("/api/stock/transfers")
    .set("Authorization", as(role, org))
    .set("Idempotency-Key", crypto.randomUUID())
    .send({ fromWarehouseId, toWarehouseId, items: [{ productId: first, quantity: 3 }, { productId: second, quantity: 5 }], note: "kirim rutin" });
  expect(res.status).toBe(201);
  return { id: res.body.id, fromWarehouseId, toWarehouseId, products: [first, second].sort() };
}

describe("GET /api/stock/transfers/:id: the answer", () => {
  it("shows the header, both warehouses, the creator and the items ordered by product ID", async () => {
    const t = await makeTransfer();

    const res = await detail(t.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: t.id,
      code: "MT-0001",
      note: "kirim rutin",
      createdAt: expect.any(String),
      createdBy: { id: world.users.A.OWNER.id, name: "OWNER A", role: "OWNER" },
      fromWarehouse: { id: t.fromWarehouseId, code: "SRC", name: "SRC", address: null },
      toWarehouse: { id: t.toWarehouseId, code: "DST", name: "DST", address: null },
      items: expect.any(Array),
    });
    expect(res.body.items.map((i) => i.productId)).toEqual(t.products);
    const bySku = Object.fromEntries(res.body.items.map((i) => [i.sku, [i.name, i.unit, i.quantity]]));
    expect(bySku).toEqual({ "SKU-AAA": ["SKU-AAA", "pcs", 3], "SKU-BBB": ["SKU-BBB", "pcs", 5] });
  });

  it("gives the movement IDs of the stored TRANSFER_OUT and TRANSFER_IN of each item", async () => {
    const t = await makeTransfer();

    const res = await detail(t.id);

    for (const item of res.body.items) {
      const rows = await sql(`SELECT id, type, "warehouseId", "quantityDelta" FROM "StockMovements" WHERE "transferId" = :id AND "productId" = :productId`, { id: t.id, productId: item.productId });
      const out = rows.find((r) => r.type === "TRANSFER_OUT");
      const into = rows.find((r) => r.type === "TRANSFER_IN");
      expect(item.outMovementId).toBe(out.id);
      expect(item.inMovementId).toBe(into.id);
      expect(out).toMatchObject({ warehouseId: t.fromWarehouseId, quantityDelta: -item.quantity });
      expect(item.outMovementId).toMatch(UUID_V4);
    }
  });

  it("holds no stock balance and no email", async () => {
    const t = await makeTransfer();
    const res = await detail(t.id);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(["inMovementId", "name", "outMovementId", "productId", "quantity", "sku", "unit"]);
    expect(Object.keys(res.body.createdBy).sort()).toEqual(["id", "name", "role"]);
    expect(res.text).not.toMatch(/@example\.com|passwordHash|"email"/);
  });

  it("does not change when the stock changes afterwards", async () => {
    const t = await makeTransfer();
    const before = await detail(t.id);
    await sql(`UPDATE "StockLevels" SET quantity = quantity + 100`);
    expect((await detail(t.id)).text).toBe(before.text);
  });

  it("answers createdBy null when the transfer has no creator", async () => {
    const t = await makeTransfer();
    await sql(`UPDATE "StockTransfers" SET "createdById" = NULL WHERE id = :id`, { id: t.id });
    expect((await detail(t.id)).body.createdBy).toBeNull();
  });

  it("shows the creator of a Warehouse Admin transfer", async () => {
    const f = await makeTransfer();
    await assignWarehouse(world.organizations.A, world.users.A.WAREHOUSE_ADMIN.id, f.fromWarehouseId);
    const made = await request(app)
      .post("/api/stock/transfers")
      .set("Authorization", as("WAREHOUSE_ADMIN"))
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ fromWarehouseId: f.fromWarehouseId, toWarehouseId: f.toWarehouseId, items: [{ productId: f.products[0], quantity: 1 }] });
    const res = await detail(made.body.id, "WAREHOUSE_ADMIN");
    expect(res.body.createdBy).toEqual({ id: world.users.A.WAREHOUSE_ADMIN.id, name: "WAREHOUSE_ADMIN A", role: "WAREHOUSE_ADMIN" });
  });
});

describe("GET /api/stock/transfers/:id: who sees it", () => {
  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("lets a %s who reaches only the SOURCE see it, with the destination movement ID null", async (role) => {
    const t = await makeTransfer();
    await assignWarehouse(world.organizations.A, world.users.A[role].id, t.fromWarehouseId);

    const res = await detail(t.id, role);

    expect(res.status).toBe(200);
    expect(res.body.toWarehouse.id).toBe(t.toWarehouseId); // the destination is named, not hidden
    expect(res.body.items.every((i) => i.outMovementId !== null && i.inMovementId === null)).toBe(true);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("lets a %s who reaches only the DESTINATION see it, with the source movement ID null", async (role) => {
    const t = await makeTransfer();
    await assignWarehouse(world.organizations.A, world.users.A[role].id, t.toWarehouseId);

    const res = await detail(t.id, role);

    expect(res.status).toBe(200);
    expect(res.body.items.every((i) => i.outMovementId === null && i.inMovementId !== null)).toBe(true);
  });

  it("gives an Owner both movement IDs", async () => {
    const t = await makeTransfer();
    const res = await detail(t.id);
    expect(res.body.items.every((i) => i.outMovementId && i.inMovementId)).toBe(true);
  });

  it("answers the same 404 body for every kind of 'not yours'", async () => {
    const t = await makeTransfer();
    const foreign = await makeTransfer({ org: "B" });

    const answers = [
      await detail(RANDOM_UUID), // missing
      await detail("not-a-uuid"), // malformed
      await detail(foreign.id), // another organization's
      await detail(t.id, "WAREHOUSE_ADMIN"), // neither warehouse assigned
      await detail(t.id, "VIEWER"), // neither warehouse assigned
    ];

    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
    expect(answers[0].body.code).toBe("NOT_FOUND");
  });

  it("answers 404 when both warehouses were archived (an Owner reaches active warehouses only, like the history)", async () => {
    const t = await makeTransfer();
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id IN (:from, :to)`, { from: t.fromWarehouseId, to: t.toWarehouseId });
    expect((await detail(t.id)).status).toBe(404);
  });

  it("still shows it when one of the two warehouses is archived and the other is reachable", async () => {
    const t = await makeTransfer();
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :to`, { to: t.toWarehouseId });
    const res = await detail(t.id);
    expect(res.status).toBe(200);
    expect(res.body.items.every((i) => i.outMovementId !== null && i.inMovementId === null)).toBe(true);
  });

  it("answers 401 without a token and 403 to the platform admin", async () => {
    const t = await makeTransfer();
    expect((await request(app).get(`/api/stock/transfers/${t.id}`)).status).toBe(401);
    const platform = await request(app).get(`/api/stock/transfers/${t.id}`).set("Authorization", world.platformAdmin.authorization);
    expect(platform.status).toBe(403);
  });
});
