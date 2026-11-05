const crypto = require("crypto");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { sql, send, quantityOf, levelRows, keyRows, withFailingStockLevelInsert } = require("./support/stockProof");

jest.setTimeout(60000);

// BL13: a failure midway rolls everything back. Written BEFORE the transfer service exists (E5-02)
// and left red on purpose. Two products, both decremented in the source, then the creation of the
// destination rows fails inside the database (a trigger, see withFailingStockLevelInsert): the
// error comes AFTER the source decrements, so only a real rollback leaves the source untouched.
const INITIAL_STOCK = 10;

let world;
let data;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  const fromWarehouseId = await world.createWarehouse("A", "SRC");
  const toWarehouseId = await world.createWarehouse("A", "DST");
  const productIds = [await world.createProduct("A"), await world.createProduct("A")];
  for (const productId of productIds) await createStockLevel(world.organizations.A, fromWarehouseId, productId, INITIAL_STOCK);
  data = { fromWarehouseId, toWarehouseId, productIds };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const count = async (table) => Number((await sql(`SELECT count(*) AS n FROM "${table}"`))[0].n);
const transfer = (key) =>
  send(
    app,
    world,
    "/api/stock/transfers",
    {
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      items: data.productIds.map((productId) => ({ productId, quantity: 3 })),
    },
    { key },
  );

describe("transfer atomicity: an error after the source decrement", () => {
  it("leaves the source stock unchanged and writes no movement, no destination row, no transfer and no key", async () => {
    const res = await withFailingStockLevelInsert(() => transfer());

    // The error is the forced one (an unexpected failure is a generic 500 without details).
    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(res.text).not.toMatch(/on purpose|trigger|StockLevels/i);

    // Everything is back as it was: the source rows hold 10, nothing exists elsewhere.
    for (const productId of data.productIds) {
      expect(await quantityOf(data.fromWarehouseId, productId)).toBe(INITIAL_STOCK);
      expect(await levelRows(data.toWarehouseId, productId)).toBe(0);
    }
    expect(await count("StockMovements")).toBe(0);
    expect(await count("StockTransfers")).toBe(0);
    expect(await keyRows()).toBe(0);
  });

  it("lets the same Idempotency-Key succeed afterwards, because the failed attempt stored nothing", async () => {
    const key = crypto.randomUUID();
    expect((await withFailingStockLevelInsert(() => transfer(key))).status).toBe(500);

    const retry = await transfer(key);

    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();
    for (const productId of data.productIds) {
      expect(await quantityOf(data.fromWarehouseId, productId)).toBe(INITIAL_STOCK - 3);
      expect(await quantityOf(data.toWarehouseId, productId)).toBe(3);
    }
    expect(await count("StockMovements")).toBe(4);
  });
});
