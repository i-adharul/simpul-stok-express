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
const get = (role = "OWNER", query = {}) => request(app).get("/api/dashboard").query(query).set("Authorization", as(role));
const key = () => crypto.randomUUID();
const receive = (body, role = "OWNER") =>
  request(app).post("/api/stock/receive").set("Authorization", as(role)).set("Idempotency-Key", key()).send(body);
const transfer = (body) => request(app).post("/api/stock/transfers").set("Authorization", as("OWNER")).set("Idempotency-Key", key()).send(body);
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const productWith = async (minStock, organization = "A") => {
  const id = await world.createProduct(organization);
  await sql(`UPDATE "Products" SET "minStock" = :minStock WHERE id = :id`, { id, minStock });
  return id;
};

describe("GET /api/dashboard: access", () => {
  it("is 401 without a token", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("is 403 for a platform admin", async () => {
    const res = await request(app).get("/api/dashboard").set("Authorization", world.platformAdmin.authorization);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])("is 200 for a %s, even without any warehouse or data", async (role) => {
    const res = await get(role);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      summary: { totalProducts: 0, totalUnits: 0, lowCount: 0, outCount: 0, movementsToday: 0 },
      restock: { items: [], total: 0 },
      recentActivity: [],
    });
  });

  it("is never cached", async () => {
    expect((await get()).headers["cache-control"]).toBe("no-store");
  });
});

describe("GET /api/dashboard: the answer", () => {
  it("has the documented body after real writes: a receipt and a transfer (two movements)", async () => {
    const from = await world.createWarehouse("A", "GD-1");
    const to = await world.createWarehouse("A", "GD-2");
    const productId = await productWith(50);

    expect((await receive({ warehouseId: from, productId, quantity: 10 })).status).toBe(201);
    expect((await transfer({ fromWarehouseId: from, toWarehouseId: to, items: [{ productId, quantity: 4 }] })).status).toBe(201);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ totalProducts: 1, totalUnits: 10, lowCount: 2, outCount: 0, movementsToday: 3 });
    expect(res.body.restock.total).toBe(2);
    expect(res.body.restock.items.map((i) => [i.warehouse.code, i.quantity, i.status])).toEqual([["GD-2", 4, "LOW"], ["GD-1", 6, "LOW"]]);
    expect(res.body.recentActivity).toHaveLength(3);
    expect(res.body.recentActivity.map((i) => i.type).sort()).toEqual(["RECEIVE", "TRANSFER_IN", "TRANSFER_OUT"]);
    const moved = res.body.recentActivity.find((i) => i.type === "TRANSFER_OUT");
    expect(moved.transfer).toEqual({ id: expect.any(String), code: "MT-0001" });
    expect(moved.createdBy).toEqual({ id: world.users.A.OWNER.id, name: world.users.A.OWNER.name });
  });

  it("covers only the assigned warehouses for a Viewer, but counts every active product", async () => {
    const mine = await world.createWarehouse("A", "GD-MINE");
    const other = await world.createWarehouse("A", "GD-OTHER");
    await assignWarehouse(world.organizations.A, world.users.A.VIEWER.id, mine);
    const p = await productWith(5);
    await productWith(0);
    await createStockLevel(world.organizations.A, mine, p, 0);
    await createStockLevel(world.organizations.A, other, p, 0);

    const viewer = (await get("VIEWER")).body;
    const owner = (await get("OWNER")).body;

    expect(viewer.summary.totalProducts).toBe(2);
    expect(viewer.summary.outCount).toBe(1);
    expect(viewer.restock.items.map((i) => i.warehouse.code)).toEqual(["GD-MINE"]);
    expect(owner.summary.outCount).toBe(2);
    expect(owner.restock.total).toBe(2);
  });

  it("ignores a query: a warehouseId or organizationId in it cannot widen or move the answer", async () => {
    const mine = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    await assignWarehouse(world.organizations.A, world.users.A.VIEWER.id, mine);
    await createStockLevel(world.organizations.B, foreign, await productWith(5, "B"), 0);

    const res = await get("VIEWER", { warehouseId: foreign, organizationId: world.organizations.B });

    expect(res.status).toBe(200);
    expect(res.body.summary.totalProducts).toBe(0);
    expect(res.body.restock).toEqual({ items: [], total: 0 });
    expect(res.text).not.toContain(foreign);
  });

  it("never shows data of another organization", async () => {
    const foreign = await world.createWarehouse("B");
    const product = await productWith(5, "B");
    await createStockLevel(world.organizations.B, foreign, product, 0);
    await sql(
      `INSERT INTO "StockMovements" ("organizationId", "warehouseId", "productId", "quantityDelta", type) VALUES (:o, :w, :p, 5, 'RECEIVE')`,
      { o: world.organizations.B, w: foreign, p: product },
    );

    const res = await get("OWNER");

    expect(res.body.summary).toEqual({ totalProducts: 0, totalUnits: 0, lowCount: 0, outCount: 0, movementsToday: 0 });
    expect(res.body.recentActivity).toEqual([]);
  });
});
