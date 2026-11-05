const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { constraintOf } = require("./support/constraintOf");
const { createWorld, createStockLevel } = require("./support/factories");
const { tenant } = require("../helpers/tenantScope");
const { sql, send, quantityOf } = require("./support/stockProof");

jest.setTimeout(60000);

// BL15 (stock never negative). Two layers are proven separately: the application refuses (409) and,
// when the application code is bypassed, the database CHECK (quantity >= 0) still refuses.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const CHECK_NAME = "StockLevels_quantity_check";
async function pair(stock) {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  const id = await createStockLevel(world.organizations.A, warehouseId, productId, stock);
  return { warehouseId, productId, id };
}

describe("BL15: the database CHECK works when the application is bypassed (direct SQL)", () => {
  it("refuses an UPDATE that sets the quantity below 0", async () => {
    const p = await pair(5);
    const error = await constraintOf(sql(`UPDATE "StockLevels" SET quantity = -1 WHERE id = :id`, { id: p.id }));
    expect(error).toBe(CHECK_NAME);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(5);
  });

  it("refuses an UPDATE that subtracts more than is there", async () => {
    const p = await pair(5);
    expect(await constraintOf(sql(`UPDATE "StockLevels" SET quantity = quantity - 6 WHERE id = :id`, { id: p.id }))).toBe(CHECK_NAME);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(5);
  });

  it("refuses an INSERT with a negative quantity", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    const insert = sql(
      `INSERT INTO "StockLevels" ("organizationId", "warehouseId", "productId", quantity) VALUES (:o, :w, :p, -1)`,
      { o: world.organizations.A, w: warehouseId, p: productId },
    );
    expect(await constraintOf(insert)).toBe(CHECK_NAME);
    expect(await quantityOf(warehouseId, productId)).toBeUndefined();
  });

  it("refuses a bulk UPDATE as a whole: one bad row leaves every row unchanged", async () => {
    const a = await pair(5);
    const b = await pair(1);
    await expect(sql(`UPDATE "StockLevels" SET quantity = quantity - 3`)).rejects.toThrow();
    expect(await quantityOf(a.warehouseId, a.productId)).toBe(5);
    expect(await quantityOf(b.warehouseId, b.productId)).toBe(1);
  });

  it("allows exactly 0", async () => {
    const p = await pair(5);
    await sql(`UPDATE "StockLevels" SET quantity = 0 WHERE id = :id`, { id: p.id });
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(0);
  });

  it("refuses a negative quantity written through the data access layer, skipping the service guard", async () => {
    const p = await pair(5);
    const ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };

    await expect(tenant(ctx).StockLevel.update({ quantity: -1 }, { where: { id: p.id } })).rejects.toThrow(/StockLevels_quantity_check|check constraint/);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(5);
  });

  it("is declared by the database, not only by the model (the constraint exists in pg_constraint)", async () => {
    const rows = await sql(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = :name`, { name: CHECK_NAME });
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/quantity.*>=\s*0/);
  });
});

describe("BL15: the application refuses first, with a 409 and no change", () => {
  const adjust = (body) => send(app, world, "/api/stock/adjust", { mode: "DELTA", reason: "LOST", ...body });

  it("answers 409 CONFLICT, not a database error, for a DELTA below 0", async () => {
    const p = await pair(2);
    const res = await adjust({ warehouseId: p.warehouseId, productId: p.productId, value: -3 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.text).not.toMatch(/check|constraint|StockLevels/i);
  });

  it("never lets the quantity go below 0 under heavy parallel load (30 requests of -1 on 12 units)", async () => {
    const p = await pair(12);

    const responses = await Promise.all(Array.from({ length: 30 }, () => adjust({ warehouseId: p.warehouseId, productId: p.productId, value: -1 })));

    expect(responses.filter((r) => r.status === 201)).toHaveLength(12);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(18);
    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(0);
    const [{ n }] = await sql(`SELECT count(*) AS n FROM "StockLevels" WHERE quantity < 0`);
    expect(Number(n)).toBe(0);
  });

  it("holds when adjustments and receipts compete: the final quantity equals the sum of what succeeded", async () => {
    const p = await pair(5);
    const receive = () => send(app, world, "/api/stock/receive", { warehouseId: p.warehouseId, productId: p.productId, quantity: 2 });

    const responses = await Promise.all([
      ...Array.from({ length: 10 }, () => adjust({ warehouseId: p.warehouseId, productId: p.productId, value: -2 })),
      ...Array.from({ length: 5 }, receive),
    ]);

    const taken = responses.slice(0, 10).filter((r) => r.status === 201).length;
    expect(responses.slice(10).every((r) => r.status === 201)).toBe(true);
    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(5 + 5 * 2 - taken * 2);
    expect(await quantityOf(p.warehouseId, p.productId)).toBeGreaterThanOrEqual(0);
  });
});
