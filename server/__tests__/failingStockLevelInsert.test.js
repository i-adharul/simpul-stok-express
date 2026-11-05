const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { sql, quantityOf, withFailingStockLevelInsert } = require("./support/stockProof");

// The test aid of E5-02: a database trigger that fails every INSERT into StockLevels and is always removed.
let world;
let warehouseId;
let productId;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  warehouseId = await world.createWarehouse("A");
  productId = await world.createProduct("A");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const insertLevel = () => createStockLevel(world.organizations.A, warehouseId, productId, 1);

describe("withFailingStockLevelInsert", () => {
  it("makes an INSERT into StockLevels fail while the body runs, and leaves no row", async () => {
    await withFailingStockLevelInsert(async () => {
      await expect(insertLevel()).rejects.toThrow(/stock level insert failed on purpose/);
    });
    expect(await quantityOf(warehouseId, productId)).toBeUndefined();
  });

  it("does not stop an UPDATE of an existing row (the source decrement must still work)", async () => {
    await insertLevel();
    await withFailingStockLevelInsert(() => sql(`UPDATE "StockLevels" SET quantity = quantity - 1`));
    expect(await quantityOf(warehouseId, productId)).toBe(0);
  });

  it("removes the trigger afterwards, also when the body throws", async () => {
    await expect(withFailingStockLevelInsert(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await insertLevel();
    expect(await quantityOf(warehouseId, productId)).toBe(1);
  });
});
