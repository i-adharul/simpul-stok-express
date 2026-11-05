const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { runConcurrently } = require("./support/concurrency");
const { sql, send, quantityOf, ledgerSum } = require("./support/stockProof");

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

// One unit per request, 20 requests at once against 10 units: the arithmetic of the proof is
// "exactly as many successes as there were units". Any other number means a lost update (more than
// 10, the stock would be negative) or a request that failed for the wrong reason (fewer than 10).
describe("transfer concurrency: 20 simultaneous transfers of 1 unit against a stock of 10", () => {
  const transfer = () =>
    send(app, world, "/api/stock/transfers", {
      fromWarehouseId: data.fromWarehouseId,
      toWarehouseId: data.toWarehouseId,
      items: [{ productId: data.productId, quantity: 1 }],
    });

  it("gives exactly 10 successes, the right final stock and the right number of movements", async () => {
    const responses = await runConcurrently(20, transfer);

    // The answers: 10 created, 10 refused for lack of stock, nothing else (no 5xx, no deadlock).
    expect(responses.filter((r) => r.status === 201)).toHaveLength(10);
    const refused = responses.filter((r) => r.status === 409);
    expect(refused).toHaveLength(10);
    expect(refused.every((r) => r.body.code === "INSUFFICIENT_STOCK" && r.body.details.productId === data.productId)).toBe(true);
    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);

    // The stock: the source is empty (never negative), the destination holds what left the source.
    expect(await quantityOf(data.fromWarehouseId, data.productId)).toBe(0);
    expect(await quantityOf(data.toWarehouseId, data.productId)).toBe(10);

    // The ledger: two movements per successful transfer, and each warehouse's sum equals its stock change.
    const [{ out, into }] = await sql(
      `SELECT count(*) FILTER (WHERE type = 'TRANSFER_OUT') AS out, count(*) FILTER (WHERE type = 'TRANSFER_IN') AS into FROM "StockMovements"`,
    );
    expect([Number(out), Number(into)]).toEqual([10, 10]);
    expect(await ledgerSum(data.fromWarehouseId, data.productId)).toBe(-10);
    expect(await ledgerSum(data.toWarehouseId, data.productId)).toBe(10);

    // The headers: ten transfers, ten different codes MT-0001 to MT-0010 (sequential, no gap, no repeat).
    const codes = (await sql(`SELECT code FROM "StockTransfers" ORDER BY code`)).map((row) => row.code);
    expect(codes).toEqual(Array.from({ length: 10 }, (_, i) => `MT-${String(i + 1).padStart(4, "0")}`));
  });
});
