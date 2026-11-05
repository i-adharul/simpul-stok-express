const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const stockService = require("../services/stockService");

jest.setTimeout(60000);

let world;
let ctx;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const receive = (input) => inTransaction((transaction) => stockService.receive(ctx, input, transaction));
const level = async (warehouseId, productId) =>
  (await sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0]?.quantity;
const movements = () => sql(`SELECT * FROM "StockMovements" ORDER BY "createdAt"`);
const archive = (table, id) => sql(`UPDATE "${table}" SET "archivedAt" = now() WHERE id = :id`, { id });
const MAX = 2147483647;

async function pair() {
  return { warehouseId: await world.createWarehouse("A"), productId: await world.createProduct("A") };
}

describe("stockService.receive", () => {
  it("creates the stock row and the RECEIVE movement, and returns the movement ID", async () => {
    const { warehouseId, productId } = await pair();

    const id = await receive({ warehouseId, productId, quantity: 12, note: "PO-1" });

    expect(await level(warehouseId, productId)).toBe(12);
    expect(await movements()).toEqual([
      expect.objectContaining({ id, type: "RECEIVE", quantityDelta: 12, note: "PO-1", reason: null, createdById: ctx.userId, warehouseId, productId }),
    ]);
  });

  it("adds to an existing stock row", async () => {
    const { warehouseId, productId } = await pair();
    await createStockLevel(ctx.organizationId, warehouseId, productId, 30);
    await receive({ warehouseId, productId, quantity: 12 });
    expect(await level(warehouseId, productId)).toBe(42);
  });

  it("does not lose a unit when ten receipts of one pair run at once", async () => {
    const { warehouseId, productId } = await pair();
    await Promise.all(Array.from({ length: 10 }, () => receive({ warehouseId, productId, quantity: 5 })));
    expect(await level(warehouseId, productId)).toBe(50);
    expect(await movements()).toHaveLength(10);
  });

  it("refuses a warehouse that was archived after the request was authorized: 409", async () => {
    const { warehouseId, productId } = await pair();
    await archive("Warehouses", warehouseId);
    await expect(receive({ warehouseId, productId, quantity: 1 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await movements()).toHaveLength(0);
  });

  it("answers a warehouse of another organization or a missing one with FORBIDDEN", async () => {
    const productId = await world.createProduct("A");
    const foreign = await world.createWarehouse("B");
    for (const warehouseId of [foreign, "33333333-3333-4333-8333-333333333333"]) {
      await expect(receive({ warehouseId, productId, quantity: 1 })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("answers a product of another organization or a missing one with NOT_FOUND", async () => {
    const { warehouseId } = await pair();
    const foreign = await world.createProduct("B");
    for (const productId of [foreign, "33333333-3333-4333-8333-333333333333", "not-a-uuid"]) {
      await expect(receive({ warehouseId, productId, quantity: 1 })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
    expect(await movements()).toHaveLength(0);
  });

  it("refuses an archived product: 409", async () => {
    const { warehouseId, productId } = await pair();
    await archive("Products", productId);
    await expect(receive({ warehouseId, productId, quantity: 1 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await level(warehouseId, productId)).toBeUndefined();
  });

  it("refuses a receipt that would pass the column limit, and leaves the stock and the history alone", async () => {
    const { warehouseId, productId } = await pair();
    await createStockLevel(ctx.organizationId, warehouseId, productId, MAX - 1);

    await expect(receive({ warehouseId, productId, quantity: 2 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(await level(warehouseId, productId)).toBe(MAX - 1);
    expect(await movements()).toHaveLength(0);
  });

  it("accepts a receipt that reaches the limit exactly", async () => {
    const { warehouseId, productId } = await pair();
    await createStockLevel(ctx.organizationId, warehouseId, productId, MAX - 1);
    await receive({ warehouseId, productId, quantity: 1 });
    expect(await level(warehouseId, productId)).toBe(MAX);
  });

  it("rolls the stock row back when the movement cannot be written (a note over the column length)", async () => {
    const { warehouseId, productId } = await pair();
    // The stock row is written first, then the movement insert fails in the database.
    await expect(receive({ warehouseId, productId, quantity: 1, note: "x".repeat(300) })).rejects.toThrow();
    expect(await level(warehouseId, productId)).toBeUndefined();
    expect(await movements()).toHaveLength(0);
  });
});
