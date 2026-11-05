const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel, assignWarehouse } = require("./support/factories");
const { listStock } = require("../services/stockSummaryService");

jest.setTimeout(60000);

let world;
let ctxOf;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctxOf = async (role, warehouseIds) => ({ userId: world.users.A[role].id, organizationId: world.organizations.A, role, warehouseIds });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const A = () => world.organizations.A;
const defaults = { page: 1, pageSize: 20 };
const productWith = async (sku, name, minStock = 0, organization = "A") => {
  const id = await world.createProduct(organization, sku);
  await sql(`UPDATE "Products" SET name = :name, "minStock" = :minStock WHERE id = :id`, { id, name, minStock });
  return id;
};
const level = (warehouseId, productId, quantity) => createStockLevel(A(), warehouseId, productId, quantity);

describe("status of a pair", () => {
  it("OUT at 0, LOW above 0 and below minStock, OK at or above minStock", async () => {
    const w = await world.createWarehouse("A");
    const out = await productWith("P-OUT", "A out", 5);
    const low = await productWith("P-LOW", "B low", 5);
    const edge = await productWith("P-EDGE", "C edge", 5);
    const ok = await productWith("P-OK", "D ok", 5);
    await level(w, out, 0);
    await level(w, low, 4);
    await level(w, edge, 5);
    await level(w, ok, 9);

    const result = await listStock(await ctxOf("OWNER", [w]), defaults);

    expect(result.items.map((i) => [i.product.sku, i.status])).toEqual([["P-OUT", "OUT"], ["P-LOW", "LOW"], ["P-EDGE", "OK"], ["P-OK", "OK"]]);
    expect(result.summary).toEqual({ out: 1, low: 1, ok: 2 });
  });

  it("minStock 0 or 1 is never LOW", async () => {
    const w = await world.createWarehouse("A");
    const zero = await productWith("P-0", "Zero", 0);
    const one = await productWith("P-1", "One", 1);
    await level(w, zero, 1);
    await level(w, one, 1);
    const result = await listStock(await ctxOf("OWNER", [w]), defaults);
    expect(result.items.map((i) => i.status)).toEqual(["OK", "OK"]);
    expect(result.summary.low).toBe(0);
  });

  it("filters by status and the status filter does not change the summary", async () => {
    const w = await world.createWarehouse("A");
    const a = await productWith("P-A", "A", 5);
    const b = await productWith("P-B", "B", 5);
    await level(w, a, 0);
    await level(w, b, 2);
    const result = await listStock(await ctxOf("OWNER", [w]), { ...defaults, status: "LOW" });
    expect(result.items.map((i) => i.product.sku)).toEqual(["P-B"]);
    expect(result.total).toBe(1);
    expect(result.summary).toEqual({ out: 1, low: 1, ok: 0 });
  });
});

describe("what is listed", () => {
  it("lists only pairs that have a stock row, shaped as documented, ordered by product name, warehouse code, ids", async () => {
    const w1 = await world.createWarehouse("A", "GD-B");
    const w2 = await world.createWarehouse("A", "GD-A");
    const apple = await productWith("P-1", "Apel", 3);
    const banana = await productWith("P-2", "Bawang");
    await productWith("P-3", "Tanpa stok");
    await level(w1, apple, 7);
    await level(w2, apple, 8);
    await level(w1, banana, 1);

    const result = await listStock(await ctxOf("OWNER", [w1, w2]), defaults);

    expect(result.items.map((i) => [i.product.name, i.warehouse.code])).toEqual([["Apel", "GD-A"], ["Apel", "GD-B"], ["Bawang", "GD-B"]]);
    expect(result.items[0]).toEqual({
      warehouse: { id: w2, code: "GD-A", name: "GD-A" },
      product: { id: apple, sku: "P-1", name: "Apel", unit: "pcs", minStock: 3, archived: false },
      quantity: 8,
      status: "OK",
      updatedAt: expect.any(Date),
    });
    expect(result).toMatchObject({ total: 3, page: 1, pageSize: 20 });
  });

  it("shows an archived product only while its quantity is above 0", async () => {
    const w = await world.createWarehouse("A");
    const full = await productWith("P-F", "Penuh");
    const empty = await productWith("P-E", "Kosong");
    await level(w, full, 4);
    await level(w, empty, 0);
    await sql(`UPDATE "Products" SET "archivedAt" = now()`);

    const result = await listStock(await ctxOf("OWNER", [w]), defaults);

    expect(result.items.map((i) => [i.product.sku, i.product.archived])).toEqual([["P-F", true]]);
    expect(result.summary).toEqual({ out: 0, low: 0, ok: 1 });
  });

  it("pages the list and keeps the total", async () => {
    const w = await world.createWarehouse("A");
    for (const n of [1, 2, 3, 4, 5]) await level(w, await productWith(`P-${n}`, `Produk ${n}`), n);
    const second = await listStock(await ctxOf("OWNER", [w]), { page: 2, pageSize: 2 });
    expect(second.items.map((i) => i.product.name)).toEqual(["Produk 3", "Produk 4"]);
    expect(second.total).toBe(5);
  });

  it("finds a product by part of its SKU or name, case-insensitively, and treats % and _ literally", async () => {
    const w = await world.createWarehouse("A");
    await level(w, await productWith("KOPI-01", "Kopi Arabika"), 1);
    await level(w, await productWith("TEH-01", "Teh 100% asli"), 1);
    await level(w, await productWith("GULA", "Gula_pasir"), 1);
    const ctx = await ctxOf("OWNER", [w]);
    const skus = async (q) => (await listStock(ctx, { ...defaults, q })).items.map((i) => i.product.sku);

    expect(await skus("arab")).toEqual(["KOPI-01"]);
    expect(await skus("teh-")).toEqual(["TEH-01"]);
    expect(await skus("100%")).toEqual(["TEH-01"]);
    expect(await skus("%")).toEqual(["TEH-01"]);
    expect(await skus("_")).toEqual(["GULA"]);
    expect(await skus("nothing")).toEqual([]);
  });

  it("filters by product, and a foreign or unknown product gives an empty list", async () => {
    const w = await world.createWarehouse("A");
    const mine = await productWith("P-1", "Mine");
    await level(w, mine, 1);
    await level(w, await productWith("P-2", "Other"), 1);
    const ctx = await ctxOf("OWNER", [w]);

    expect((await listStock(ctx, { ...defaults, productId: mine })).items).toHaveLength(1);
    const foreign = await world.createProduct("B");
    expect((await listStock(ctx, { ...defaults, productId: foreign })).items).toEqual([]);
    expect((await listStock(ctx, { ...defaults, productId: "33333333-3333-4333-8333-333333333333" })).total).toBe(0);
  });
});

describe("which warehouses", () => {
  it("lists only the warehouses in ctx.warehouseIds", async () => {
    const mine = await world.createWarehouse("A", "GD-1");
    const other = await world.createWarehouse("A", "GD-2");
    const p = await productWith("P-1", "P");
    await level(mine, p, 1);
    await level(other, p, 2);
    await assignWarehouse(A(), world.users.A.VIEWER.id, mine);

    const result = await listStock(await ctxOf("VIEWER", [mine]), defaults);

    expect(result.items.map((i) => i.warehouse.code)).toEqual(["GD-1"]);
    expect(result.summary).toEqual({ out: 0, low: 0, ok: 1 });
  });

  it("is empty for a caller who reaches no warehouse", async () => {
    const w = await world.createWarehouse("A");
    await level(w, await productWith("P-1", "P"), 1);
    expect(await listStock(await ctxOf("VIEWER", []), defaults)).toMatchObject({ items: [], total: 0, summary: { out: 0, low: 0, ok: 0 } });
  });

  it("authorizes warehouseId first: 403 for an unreachable, foreign, archived or missing warehouse, with one body", async () => {
    const mine = await world.createWarehouse("A");
    const unreachable = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    const archived = await world.createWarehouse("A");
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: archived });
    const ctx = await ctxOf("VIEWER", [mine]);

    const errors = [];
    for (const warehouseId of [unreachable, foreign, archived, "33333333-3333-4333-8333-333333333333"]) {
      errors.push(await listStock(ctx, { ...defaults, warehouseId }).catch((e) => e));
    }
    for (const error of errors) expect(error).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(new Set(errors.map((e) => JSON.stringify(e.toBody()))).size).toBe(1);
    await expect(listStock(ctx, { ...defaults, warehouseId: mine })).resolves.toMatchObject({ items: [] });
  });

  it("never shows a row of another organization, even when its warehouse id is in the list", async () => {
    const mine = await world.createWarehouse("A");
    const foreignWarehouse = await world.createWarehouse("B");
    const foreignProduct = await world.createProduct("B");
    await createStockLevel(world.organizations.B, foreignWarehouse, foreignProduct, 50);
    await level(mine, await productWith("P-1", "P"), 1);

    const result = await listStock(await ctxOf("OWNER", [mine, foreignWarehouse]), defaults);

    expect(result.items.map((i) => i.warehouse.id)).toEqual([mine]);
    expect(result.summary).toEqual({ out: 0, low: 0, ok: 1 });
  });
});
