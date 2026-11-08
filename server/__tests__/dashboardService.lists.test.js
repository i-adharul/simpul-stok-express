const crypto = require("crypto");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { getRestock, getRecentActivity, RESTOCK_LIMIT, ACTIVITY_LIMIT } = require("../services/dashboardService");

jest.setTimeout(60000);

let world;
let ctxOf;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctxOf = (role, warehouseIds) => ({ userId: world.users.A[role].id, organizationId: world.organizations.A, role, warehouseIds });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const productWith = async ({ name, minStock = 0, archived = false, organization = "A" } = {}) => {
  const id = await world.createProduct(organization);
  await sql(`UPDATE "Products" SET name = COALESCE(:name, name), "minStock" = :minStock, "archivedAt" = :archivedAt WHERE id = :id`, {
    id,
    name: name ?? null,
    minStock,
    archivedAt: archived ? new Date() : null,
  });
  return id;
};
const level = (warehouseId, productId, quantity, organization = "A") =>
  createStockLevel(world.organizations[organization], warehouseId, productId, quantity);

describe("restock", () => {
  it("lists only OUT and LOW pairs, with the documented shape", async () => {
    const w = await world.createWarehouse("A");
    const out = await productWith({ name: "Out", minStock: 5 });
    const low = await productWith({ name: "Low", minStock: 5 });
    await level(w, out, 0);
    await level(w, low, 4);
    await level(w, await productWith({ minStock: 5 }), 5); // OK, at the minimum
    await level(w, await productWith({ minStock: 0 }), 1); // OK

    const { items, total } = await getRestock(ctxOf("OWNER", [w]));

    expect(total).toBe(2);
    expect(items.map((i) => [i.product.name, i.status, i.quantity])).toEqual([["Out", "OUT", 0], ["Low", "LOW", 4]]);
    expect(Object.keys(items[0]).sort()).toEqual(["product", "quantity", "status", "warehouse"]);
    expect(Object.keys(items[0].product).sort()).toEqual(["id", "minStock", "name", "sku", "unit"]);
    expect(Object.keys(items[0].warehouse).sort()).toEqual(["code", "id", "name"]);
    expect(items[0].warehouse.id).toBe(w);
    expect(items[0].product.id).toBe(out);
  });

  it("puts the pair furthest below minStock first", async () => {
    const w = await world.createWarehouse("A");
    const small = await productWith({ name: "Small gap", minStock: 20 }); // 5 short
    const big = await productWith({ name: "Big gap", minStock: 10 }); // 10 short
    const mid = await productWith({ name: "Mid gap", minStock: 5 }); // 4 short
    await level(w, small, 15);
    await level(w, big, 0);
    await level(w, mid, 1);

    const { items } = await getRestock(ctxOf("OWNER", [w]));

    expect(items.map((i) => i.product.name)).toEqual(["Big gap", "Small gap", "Mid gap"]);
  });

  it("breaks a tie by product name, then warehouse code, so the answer is stable", async () => {
    const w1 = await world.createWarehouse("A", "GD-B");
    const w2 = await world.createWarehouse("A", "GD-A");
    const beta = await productWith({ name: "Beta", minStock: 5 });
    const alpha = await productWith({ name: "Alpha", minStock: 5 });
    await level(w1, beta, 0);
    await level(w1, alpha, 0);
    await level(w2, alpha, 0);

    const { items } = await getRestock(ctxOf("OWNER", [w1, w2]));

    expect(items.map((i) => [i.product.name, i.warehouse.code])).toEqual([["Alpha", "GD-A"], ["Alpha", "GD-B"], ["Beta", "GD-B"]]);
  });

  it(`holds at most ${RESTOCK_LIMIT} items while total counts every pair`, async () => {
    const w = await world.createWarehouse("A");
    for (let i = 0; i < 7; i += 1) await level(w, await productWith({ name: `P${i}`, minStock: 10 + i }), 0);

    const { items, total } = await getRestock(ctxOf("OWNER", [w]));

    expect(RESTOCK_LIMIT).toBe(5);
    expect(items).toHaveLength(5);
    expect(total).toBe(7);
    expect(items.map((i) => i.product.minStock)).toEqual([16, 15, 14, 13, 12]);
  });

  it("leaves out archived products, warehouses the caller does not reach, and other organizations", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    await level(mine, await productWith({ minStock: 5, archived: true }), 0);
    await level(other, await productWith({ minStock: 5 }), 0);
    await level(foreign, await productWith({ minStock: 5, organization: "B" }), 0, "B");
    const visible = await productWith({ name: "Visible", minStock: 5 });
    await level(mine, visible, 1);

    const result = await getRestock(ctxOf("VIEWER", [mine, foreign]));

    expect(result.total).toBe(1);
    expect(result.items.map((i) => i.product.id)).toEqual([visible]);
  });

  it("is empty with total 0 when nothing is short or the caller has no warehouse", async () => {
    const w = await world.createWarehouse("A");
    await level(w, await productWith({ minStock: 2 }), 9);

    expect(await getRestock(ctxOf("OWNER", [w]))).toEqual({ items: [], total: 0 });
    expect(await getRestock(ctxOf("VIEWER", []))).toEqual({ items: [], total: 0 });
  });
});

describe("recentActivity", () => {
  const T = (seconds) => new Date(Date.UTC(2026, 10, 5, 0, 0, seconds));
  async function movement(warehouseId, productId, { at = T(1), type = "RECEIVE", reason = null, organization = "A", createdById = null, transferId = null, delta = type === "TRANSFER_OUT" ? -5 : 5, id = crypto.randomUUID() } = {}) {
    await sql(
      `INSERT INTO "StockMovements" (id, "organizationId", "warehouseId", "productId", "quantityDelta", type, reason, "createdById", "transferId", "createdAt")
       VALUES (:id, :organizationId, :warehouseId, :productId, :delta, CAST(:type AS "enum_StockMovements_type"),
               CAST(:reason AS "enum_StockMovements_reason"), :createdById, :transferId, :at)`,
      { id, organizationId: world.organizations[organization], warehouseId, productId, type, reason, createdById, transferId, delta, at },
    );
    return id;
  }

  it(`returns the ${ACTIVITY_LIMIT} newest movements, newest first`, async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const made = [];
    for (let s = 1; s <= 7; s += 1) made.push(await movement(w, p, { at: T(s) }));

    const items = await getRecentActivity(ctxOf("OWNER", [w]));

    expect(ACTIVITY_LIMIT).toBe(5);
    expect(items.map((i) => i.id)).toEqual([made[6], made[5], made[4], made[3], made[2]]);
  });

  it("has the documented shape, with createdBy null and transfer null for a plain receipt", async () => {
    const w = await world.createWarehouse("A", "GD-9");
    const p = await world.createProduct("A", "SKU-9");
    const id = await movement(w, p, { at: T(3) });

    const [item] = await getRecentActivity(ctxOf("OWNER", [w]));

    expect(item).toEqual({
      id,
      type: "RECEIVE",
      quantityDelta: 5,
      reason: null,
      createdAt: T(3),
      warehouse: { id: w, code: "GD-9", name: "GD-9" },
      product: { id: p, sku: "SKU-9", name: "SKU-9", unit: "pcs" },
      createdBy: null,
      transfer: null,
    });
  });

  it("names the user (id and name only, never the email) and the reason of an adjustment", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const owner = world.users.A.OWNER;
    await movement(w, p, { type: "ADJUST", reason: "LOST", createdById: owner.id });

    const [item] = await getRecentActivity(ctxOf("OWNER", [w]));

    expect(item.reason).toBe("LOST");
    expect(item.createdBy).toEqual({ id: owner.id, name: owner.name });
  });

  it("shows both movements of a transfer, each with the transfer id and code", async () => {
    const from = await world.createWarehouse("A");
    const to = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const [{ id: transferId }] = await sql(
      `INSERT INTO "StockTransfers" ("organizationId", code, "fromWarehouseId", "toWarehouseId") VALUES (:o, 'TRF-1', :from, :to) RETURNING id`,
      { o: world.organizations.A, from, to },
    );
    await movement(from, p, { at: T(2), type: "TRANSFER_OUT", transferId });
    await movement(to, p, { at: T(2), type: "TRANSFER_IN", transferId });

    const items = await getRecentActivity(ctxOf("OWNER", [from, to]));

    expect(items.map((i) => i.type).sort()).toEqual(["TRANSFER_IN", "TRANSFER_OUT"]);
    expect(items.every((i) => i.transfer.id === transferId && i.transfer.code === "TRF-1")).toBe(true);
    expect(Object.keys(items[0].transfer).sort()).toEqual(["code", "id"]);
  });

  it("orders movements of the same instant by id, so the answer is stable", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const low = await movement(w, p, { at: T(1), id: "00000000-0000-4000-8000-000000000001" });
    const high = await movement(w, p, { at: T(1), id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });

    expect((await getRecentActivity(ctxOf("OWNER", [w]))).map((i) => i.id)).toEqual([low, high]);
  });

  it("shows only the caller's warehouses and organization", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    const p = await world.createProduct("A");
    const visible = await movement(mine, p, { at: T(1) });
    await movement(other, p, { at: T(2) });
    await movement(foreign, await world.createProduct("B"), { at: T(3), organization: "B" });

    expect((await getRecentActivity(ctxOf("VIEWER", [mine]))).map((i) => i.id)).toEqual([visible]);
  });

  it("is an empty list when nothing happened or the caller has no warehouse", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    await movement(w, p);

    expect(await getRecentActivity(ctxOf("OWNER", []))).toEqual([]);
    expect(await getRecentActivity({ ...ctxOf("OWNER", [await world.createWarehouse("A")]) })).toEqual([]);
  });
});
