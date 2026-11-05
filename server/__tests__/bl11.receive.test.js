const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { sql, send, quantityOf, levelRows, movementRows, ledgerSum, keyRows, withFailingMovementInsert } = require("./support/stockProof");

jest.setTimeout(60000);

// BL11 (stock receipt) as a rule, beyond the contract tests of stock-receive.test.js: one
// transaction (stock row and movement together or not at all), the stock row exists exactly once
// per pair, the movement is immutable, and the ledger adds up to the balance.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const receive = (body, options) => send(app, world, "/api/stock/receive", body, options);
async function pair() {
  return { warehouseId: await world.createWarehouse("A"), productId: await world.createProduct("A") };
}

describe("BL11: one transaction", () => {
  it("leaves no stock row, no movement and no key when the movement insert fails (the pair is new)", async () => {
    const { warehouseId, productId } = await pair();

    const res = await withFailingMovementInsert(() => receive({ warehouseId, productId, quantity: 10 }));

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(await levelRows(warehouseId, productId)).toBe(0);
    expect(await movementRows(warehouseId, productId)).toHaveLength(0);
    expect(await keyRows()).toBe(0);
  });

  it("leaves the old balance alone when the movement insert fails (the pair has stock)", async () => {
    const { warehouseId, productId } = await pair();
    await createStockLevel(world.organizations.A, warehouseId, productId, 7);

    const res = await withFailingMovementInsert(() => receive({ warehouseId, productId, quantity: 10 }));

    expect(res.status).toBe(500);
    expect(await quantityOf(warehouseId, productId)).toBe(7);
  });

  it("does not leak the database message in the 500 body", async () => {
    const { warehouseId, productId } = await pair();
    const res = await withFailingMovementInsert(() => receive({ warehouseId, productId, quantity: 1 }));
    expect(res.text).not.toMatch(/on purpose|trigger|StockMovements|plpgsql/i);
  });

  it("works again once the failure is gone, with the same key", async () => {
    const { warehouseId, productId } = await pair();
    const key = "7b0d6a54-1f0e-4a39-9a1c-5d2f8c3e4b10";
    await withFailingMovementInsert(() => receive({ warehouseId, productId, quantity: 4 }, { key }));

    const retry = await receive({ warehouseId, productId, quantity: 4 }, { key });

    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();
    expect(await quantityOf(warehouseId, productId)).toBe(4);
  });
});

describe("BL11: the stock row", () => {
  it("exists exactly once per pair when ten first receipts arrive at the same time", async () => {
    const { warehouseId, productId } = await pair();

    const responses = await Promise.all(Array.from({ length: 10 }, () => receive({ warehouseId, productId, quantity: 3 })));

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await levelRows(warehouseId, productId)).toBe(1);
    expect(await quantityOf(warehouseId, productId)).toBe(30);
  });

  it("keeps a separate row per product and per warehouse", async () => {
    const { warehouseId, productId } = await pair();
    const otherProduct = await world.createProduct("A");
    const otherWarehouse = await world.createWarehouse("A");
    await receive({ warehouseId, productId, quantity: 1 });
    await receive({ warehouseId, productId: otherProduct, quantity: 2 });
    await receive({ warehouseId: otherWarehouse, productId, quantity: 4 });

    expect([await quantityOf(warehouseId, productId), await quantityOf(warehouseId, otherProduct), await quantityOf(otherWarehouse, productId)]).toEqual([1, 2, 4]);
  });

  it("adds up exactly under twenty parallel receipts of different sizes", async () => {
    const { warehouseId, productId } = await pair();
    const sizes = Array.from({ length: 20 }, (_, n) => n + 1);

    const responses = await Promise.all(sizes.map((quantity) => receive({ warehouseId, productId, quantity })));

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await quantityOf(warehouseId, productId)).toBe(210);
  });
});

describe("BL11: the movement", () => {
  it("is a RECEIVE row with the quantity, the note and the creator", async () => {
    const { warehouseId, productId } = await pair();
    await receive({ warehouseId, productId, quantity: 12, note: "PO-9" });
    const [row] = await movementRows(warehouseId, productId);
    expect(row).toMatchObject({ type: "RECEIVE", quantityDelta: 12, note: "PO-9", reason: null, transferId: null, importJobId: null, createdById: world.users.A.OWNER.id });
  });

  it("cannot be changed or deleted afterwards (the append-only trigger)", async () => {
    const { warehouseId, productId } = await pair();
    const res = await receive({ warehouseId, productId, quantity: 5 });
    await expect(sql(`UPDATE "StockMovements" SET "quantityDelta" = 500 WHERE id = :id`, { id: res.body.id })).rejects.toThrow(/append-only/);
    await expect(sql(`DELETE FROM "StockMovements" WHERE id = :id`, { id: res.body.id })).rejects.toThrow(/append-only/);
    expect((await movementRows(warehouseId, productId))[0].quantityDelta).toBe(5);
  });

  it("adds up, together with every other movement, to the balance (the ledger)", async () => {
    const { warehouseId, productId } = await pair();
    await receive({ warehouseId, productId, quantity: 100 });
    await send(app, world, "/api/stock/adjust", { warehouseId, productId, mode: "SET", value: 60, reason: "STOCK_OPNAME" });
    await receive({ warehouseId, productId, quantity: 15 });
    await send(app, world, "/api/stock/adjust", { warehouseId, productId, mode: "DELTA", value: -5, reason: "LOST" });

    expect(await ledgerSum(warehouseId, productId)).toBe(70);
    expect(await quantityOf(warehouseId, productId)).toBe(70);
  });

  it("is not written for a request that was refused", async () => {
    const { warehouseId, productId } = await pair();
    await receive({ warehouseId, productId, quantity: 0 });
    await receive({ warehouseId, productId, quantity: 1 }, { role: "VIEWER" });
    await receive({ warehouseId, productId: "33333333-3333-4333-8333-333333333333", quantity: 1 });
    expect(await movementRows(warehouseId, productId)).toHaveLength(0);
    expect(await levelRows(warehouseId, productId)).toBe(0);
  });
});

describe("BL11: the range of the quantity", () => {
  it.each([[0, 400], [1, 201], [1000000, 201], [1000001, 400], [-1, 400], [1.5, 400], ["10", 400], [null, 400]])("quantity %p gives %p", async (quantity, status) => {
    const { warehouseId, productId } = await pair();
    expect((await receive({ warehouseId, productId, quantity })).status).toBe(status);
    expect((await movementRows(warehouseId, productId)).length).toBe(status === 201 ? 1 : 0);
  });
});
