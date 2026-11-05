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

const orgA = () => world.organizations.A;
const as = (role) => world.users.A[role].authorization;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";
const get = (query = {}, role = "OWNER") => request(app).get("/api/stock").query(query).set("Authorization", as(role));
const product = async (sku, name, minStock = 0) => {
  const id = await world.createProduct("A", sku);
  await sql(`UPDATE "Products" SET name = :name, "minStock" = :minStock WHERE id = :id`, { id, name, minStock });
  return id;
};
const stock = (warehouseId, productId, quantity) => createStockLevel(orgA(), warehouseId, productId, quantity);

describe("GET /api/stock: status and summary", () => {
  it("answers 200 with the documented shape, the status of each pair and the summary", async () => {
    const w = await world.createWarehouse("A", "GD-1");
    const out = await product("P-1", "Apel", 5);
    const low = await product("P-2", "Bawang", 5);
    const ok = await product("P-3", "Cabai", 5);
    await stock(w, out, 0);
    await stock(w, low, 3);
    await stock(w, ok, 5);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      items: [
        { warehouse: { id: w, code: "GD-1", name: "GD-1" }, product: { id: out, sku: "P-1", name: "Apel", unit: "pcs", minStock: 5, archived: false }, quantity: 0, status: "OUT", updatedAt: expect.any(String) },
        { warehouse: expect.any(Object), product: expect.objectContaining({ sku: "P-2" }), quantity: 3, status: "LOW", updatedAt: expect.any(String) },
        { warehouse: expect.any(Object), product: expect.objectContaining({ sku: "P-3" }), quantity: 5, status: "OK", updatedAt: expect.any(String) },
      ],
      total: 3,
      page: 1,
      pageSize: 20,
      summary: { out: 1, low: 1, ok: 1 },
    });
  });

  it("filters by status; the summary still counts the other statuses", async () => {
    const w = await world.createWarehouse("A");
    await stock(w, await product("P-1", "A", 5), 0);
    await stock(w, await product("P-2", "B", 5), 1);
    const res = await get({ status: "OUT" });
    expect(res.body.items.map((i) => i.product.sku)).toEqual(["P-1"]);
    expect(res.body.total).toBe(1);
    expect(res.body.summary).toEqual({ out: 1, low: 1, ok: 0 });
  });

  it("never marks a product with minStock 0 or 1 as LOW", async () => {
    const w = await world.createWarehouse("A");
    await stock(w, await product("P-1", "A", 0), 1);
    await stock(w, await product("P-2", "B", 1), 1);
    const res = await get({ status: "LOW" });
    expect(res.body.items).toEqual([]);
  });

  it("does not list a pair without a stock row", async () => {
    await world.createWarehouse("A");
    await product("P-1", "Tanpa stok");
    expect((await get()).body).toMatchObject({ items: [], total: 0, summary: { out: 0, low: 0, ok: 0 } });
  });

  it("shows an archived product only while its quantity is above 0, with archived: true", async () => {
    const w = await world.createWarehouse("A");
    const full = await product("P-1", "Penuh");
    const empty = await product("P-2", "Kosong");
    await stock(w, full, 3);
    await stock(w, empty, 0);
    await sql(`UPDATE "Products" SET "archivedAt" = now()`);
    const res = await get();
    expect(res.body.items.map((i) => [i.product.sku, i.product.archived])).toEqual([["P-1", true]]);
  });
});

describe("GET /api/stock: filters and paging", () => {
  it("searches SKU or name case-insensitively, and by product", async () => {
    const w = await world.createWarehouse("A");
    const kopi = await product("KOPI-1", "Kopi Arabika");
    await stock(w, kopi, 1);
    await stock(w, await product("TEH-1", "Teh Hijau"), 1);
    expect((await get({ q: "arabika" })).body.items.map((i) => i.product.sku)).toEqual(["KOPI-1"]);
    expect((await get({ q: "teh-1" })).body.items.map((i) => i.product.sku)).toEqual(["TEH-1"]);
    expect((await get({ q: "   " })).body.total).toBe(2);
    expect((await get({ productId: kopi })).body.items).toHaveLength(1);
  });

  it("gives an empty list for a foreign or unknown product", async () => {
    const w = await world.createWarehouse("A");
    await stock(w, await product("P-1", "A"), 1);
    const foreign = await world.createProduct("B");
    for (const productId of [foreign, RANDOM_UUID]) {
      const res = await get({ productId });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    }
  });

  it("pages with page and pageSize, and the order is product name then warehouse code", async () => {
    const w1 = await world.createWarehouse("A", "GD-B");
    const w2 = await world.createWarehouse("A", "GD-A");
    const p = await product("P-1", "Apel");
    await stock(w1, p, 1);
    await stock(w2, p, 2);
    await stock(w1, await product("P-2", "Bawang"), 3);
    const first = await get({ page: 1, pageSize: 2 });
    const second = await get({ page: 2, pageSize: 2 });
    expect(first.body.items.map((i) => i.warehouse.code)).toEqual(["GD-A", "GD-B"]);
    expect(second.body.items.map((i) => i.product.sku)).toEqual(["P-2"]);
    expect(second.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
  });

  it.each([
    ["warehouseId that is not a UUID", { warehouseId: "abc" }],
    ["productId that is not a UUID", { productId: "abc" }],
    ["an unknown status", { status: "FULL" }],
    ["a status in lower case", { status: "out" }],
    ["page 0", { page: "0" }],
    ["pageSize 0", { pageSize: "0" }],
    ["pageSize 101", { pageSize: "101" }],
    ["page that is not a number", { page: "abc" }],
    ["q over 100 characters", { q: "x".repeat(101) }],
    ["includeArchived (not part of this query)", { includeArchived: "true" }],
    ["organizationId", { organizationId: RANDOM_UUID }],
  ])("answers 400 VALIDATION_ERROR for %s", async (_name, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].source).toBe("query");
  });

  it("accepts pageSize 100 and q of exactly 100 characters", async () => {
    expect((await get({ pageSize: "100", q: "x".repeat(100) })).status).toBe(200);
  });
});

describe("GET /api/stock: which warehouses", () => {
  async function twoWarehouses() {
    const mine = await world.createWarehouse("A", "GD-1");
    const other = await world.createWarehouse("A", "GD-2");
    const p = await product("P-1", "Apel");
    await stock(mine, p, 4);
    await stock(other, p, 9);
    return { mine, other };
  }

  it("shows the Owner every active warehouse", async () => {
    await twoWarehouses();
    expect((await get()).body.items.map((i) => i.warehouse.code)).toEqual(["GD-1", "GD-2"]);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("shows a %s only the assigned warehouses", async (role) => {
    const { mine } = await twoWarehouses();
    await assignWarehouse(orgA(), world.users.A[role].id, mine);
    const res = await get({}, role);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.warehouse.code)).toEqual(["GD-1"]);
    expect(res.body.summary).toEqual({ out: 0, low: 0, ok: 1 });
  });

  it("is empty for a Viewer with no assignment", async () => {
    await twoWarehouses();
    expect((await get({}, "VIEWER")).body).toMatchObject({ items: [], total: 0 });
  });

  it("does not list the stock of an archived warehouse", async () => {
    const { other } = await twoWarehouses();
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: other });
    expect((await get()).body.items.map((i) => i.warehouse.code)).toEqual(["GD-1"]);
  });

  it("filters by an accessible warehouseId", async () => {
    const { mine } = await twoWarehouses();
    expect((await get({ warehouseId: mine })).body.items.map((i) => i.warehouse.code)).toEqual(["GD-1"]);
  });

  it("answers 403 with one body for an unassigned, a foreign, an archived and a missing warehouseId", async () => {
    const { mine, other } = await twoWarehouses();
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, mine);
    const archived = await world.createWarehouse("A");
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: archived });
    const foreign = await world.createWarehouse("B");

    const bodies = [];
    for (const warehouseId of [other, foreign, archived, RANDOM_UUID]) {
      const res = await get({ warehouseId }, "VIEWER");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("answers 403 to the Owner for a foreign or missing warehouseId, and 401 / 403 without a token / for a platform admin", async () => {
    const foreign = await world.createWarehouse("B");
    expect((await get({ warehouseId: foreign })).status).toBe(403);
    expect((await get({ warehouseId: RANDOM_UUID })).status).toBe(403);
    expect((await request(app).get("/api/stock")).status).toBe(401);
    expect((await request(app).get("/api/stock").set("Authorization", world.platformAdmin.authorization)).status).toBe(403);
  });

  it("never shows the stock of another organization", async () => {
    await twoWarehouses();
    const wb = await world.createWarehouse("B");
    const pb = await world.createProduct("B");
    await createStockLevel(world.organizations.B, wb, pb, 99);
    const res = await get();
    expect(res.text).not.toContain(wb);
    expect(res.text).not.toContain(pb);
  });
});
