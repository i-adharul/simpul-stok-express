const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { sql, send, quantityOf, levelRows, movementRows, ledgerSum, keyRows, withFailingMovementInsert } = require("./support/stockProof");

jest.setTimeout(60000);

// BL12 (stock adjustment) as a rule, beyond stock-adjust.test.js: a reason is always recorded, the
// movement holds the signed difference, a result below 0 or an unchanged quantity writes nothing,
// one transaction, and the ledger adds up to the balance.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const adjust = (body, options) => send(app, world, "/api/stock/adjust", body, options);
async function pair(stock) {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  if (stock !== undefined) await createStockLevel(world.organizations.A, warehouseId, productId, stock);
  return { warehouseId, productId };
}

describe("BL12: the reason", () => {
  it.each([
    ["STOCK_OPNAME", "Stok opname"],
    ["DAMAGED", "Rusak"],
    ["LOST", "Hilang"],
    ["CORRECTION", "Koreksi"],
  ])("records %s on the movement and in the answer", async (reason) => {
    const p = await pair(10);
    const res = await adjust({ ...p, mode: "DELTA", value: -1, reason });
    expect(res.body.reason).toBe(reason);
    expect((await movementRows(p.warehouseId, p.productId))[0].reason).toBe(reason);
  });

  it("is required: no movement and no change without it", async () => {
    const p = await pair(10);
    const res = await adjust({ ...p, mode: "DELTA", value: -1 });
    expect(res.status).toBe(400);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10);
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(0);
  });

  it("must be one of the four: free text is refused", async () => {
    const p = await pair(10);
    expect((await adjust({ ...p, mode: "SET", value: 5, reason: "karena saya mau" })).status).toBe(400);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10);
  });
});

describe("BL12: the difference", () => {
  it("is stored signed: negative when stock goes down, positive when it goes up", async () => {
    const p = await pair(10);
    await adjust({ ...p, mode: "SET", value: 4, reason: "STOCK_OPNAME" });
    await adjust({ ...p, mode: "SET", value: 9, reason: "STOCK_OPNAME" });
    expect((await movementRows(p.warehouseId, p.productId)).map((m) => m.quantityDelta)).toEqual([-6, 5]);
  });

  it("is never 0: an adjustment that changes nothing is a 400 and writes no movement", async () => {
    const p = await pair(10);
    expect((await adjust({ ...p, mode: "SET", value: 10, reason: "STOCK_OPNAME" })).status).toBe(400);
    expect((await adjust({ ...p, mode: "DELTA", value: 0, reason: "CORRECTION" })).status).toBe(400);
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(0);
  });

  it("gives the same final quantity in SET and in DELTA mode for the same change", async () => {
    const a = await pair(20);
    const b = await pair(20);
    await adjust({ ...a, mode: "SET", value: 15, reason: "CORRECTION" });
    await adjust({ ...b, mode: "DELTA", value: -5, reason: "CORRECTION" });
    expect(await quantityOf(a.warehouseId, a.productId)).toBe(15);
    expect(await quantityOf(b.warehouseId, b.productId)).toBe(15);
    expect((await movementRows(a.warehouseId, a.productId))[0].quantityDelta).toBe(-5);
    expect((await movementRows(b.warehouseId, b.productId))[0].quantityDelta).toBe(-5);
  });
});

describe("BL12: the result is never negative", () => {
  it("refuses a DELTA below 0 with 409 and writes nothing, for every size of overshoot", async () => {
    for (const value of [-6, -100, -1000000]) {
      const p = await pair(5);
      const res = await adjust({ ...p, mode: "DELTA", value, reason: "LOST" });
      expect(res.status).toBe(409);
      expect(await quantityOf(p.warehouseId, p.productId)).toBe(5);
      expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(0);
    }
  });

  it("refuses a negative DELTA on a pair that has no stock row, and creates no row", async () => {
    const p = await pair();
    expect((await adjust({ ...p, mode: "DELTA", value: -1, reason: "LOST" })).status).toBe(409);
    expect(await levelRows(p.warehouseId, p.productId)).toBe(0);
  });

  it("never lets the sum of simultaneous DELTA -3 go below 0 (10 units: three succeed, one is left)", async () => {
    const p = await pair(10);
    const responses = await Promise.all(Array.from({ length: 8 }, () => adjust({ ...p, mode: "DELTA", value: -3, reason: "DAMAGED" })));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(1);
  });
});

describe("BL12: one transaction", () => {
  it("leaves the balance, the movements and the key alone when the movement insert fails", async () => {
    const p = await pair(10);
    const res = await withFailingMovementInsert(() => adjust({ ...p, mode: "SET", value: 3, reason: "STOCK_OPNAME" }));
    expect(res.status).toBe(500);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10);
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(0);
    expect(await keyRows()).toBe(0);
  });

  it("leaves no stock row behind when a SET on a new pair fails at the movement", async () => {
    const p = await pair();
    await withFailingMovementInsert(() => adjust({ ...p, mode: "SET", value: 8, reason: "CORRECTION" }));
    expect(await levelRows(p.warehouseId, p.productId)).toBe(0);
  });
});

describe("BL12: where an adjustment may happen", () => {
  it("accepts an archived product and refuses an archived warehouse (403, nothing written)", async () => {
    const p = await pair(5);
    await sql(`UPDATE "Products" SET "archivedAt" = now() WHERE id = :id`, { id: p.productId });
    expect((await adjust({ ...p, mode: "SET", value: 0, reason: "CORRECTION" })).status).toBe(201);

    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: p.warehouseId });
    expect((await adjust({ ...p, mode: "DELTA", value: 1, reason: "CORRECTION" })).status).toBe(403);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(0);
  });
});

describe("BL12: the ledger", () => {
  it("adds up to the balance after many mixed adjustments", async () => {
    const p = await pair(50);
    await adjust({ ...p, mode: "DELTA", value: 10, reason: "CORRECTION" });
    await adjust({ ...p, mode: "SET", value: 25, reason: "STOCK_OPNAME" });
    await adjust({ ...p, mode: "DELTA", value: -5, reason: "DAMAGED" });
    await adjust({ ...p, mode: "SET", value: 100, reason: "STOCK_OPNAME" });

    // The pair started with 50 and no movement (a row inserted directly), so the ledger holds only the change.
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(100);
    expect(await ledgerSum(p.warehouseId, p.productId)).toBe(50);
  });
});
