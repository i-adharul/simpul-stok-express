const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { quantityOf } = require("./support/stockProof");

jest.setTimeout(60000);

// BL13 + BL15 under concurrency. Written BEFORE the transfer service exists (E5-01) and left red on
// purpose: the failure is seen first, then E5-03 makes it pass. The initial data is the same for
// every test: the source warehouse holds exactly 10 units of one product, the destination none.
const INITIAL_STOCK = 10;

let world;
let data;

beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  const fromWarehouseId = await world.createWarehouse("A", "SRC");
  const toWarehouseId = await world.createWarehouse("A", "DST");
  const productId = await world.createProduct("A");
  await createStockLevel(world.organizations.A, fromWarehouseId, productId, INITIAL_STOCK);
  data = { fromWarehouseId, toWarehouseId, productId };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("transfer concurrency: the initial data", () => {
  it("has 10 units in the source warehouse and no stock row in the destination", async () => {
    expect(await quantityOf(data.fromWarehouseId, data.productId)).toBe(INITIAL_STOCK);
    expect(await quantityOf(data.toWarehouseId, data.productId)).toBeUndefined();
  });
});
