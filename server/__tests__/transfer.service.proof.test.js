const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { runConcurrently } = require("./support/concurrency");
const { sql, quantityOf, ledgerSum, withFailingStockLevelInsert } = require("./support/stockProof");
const { inTransaction } = require("../helpers/transaction");
const { transfer } = require("../services/transferService");

jest.setTimeout(60000);

// The same proofs as transfer.concurrency.test.js (E5-01) and transfer.atomicity.test.js (E5-02),
// but through the service instead of POST /api/stock/transfers, so they can pass before the
// endpoint exists (E5-04). The two HTTP tests stay the official proof and turn green with E5-04.
let world;
let ctx;
let from;
let to;
let productId;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  from = await world.createWarehouse("A", "SRC");
  to = await world.createWarehouse("A", "DST");
  productId = await world.createProduct("A");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const run = (fromWarehouseId, toWarehouseId, items) => inTransaction((t) => transfer(ctx, { fromWarehouseId, toWarehouseId, items }, t)).then(
  (id) => ({ ok: true, id }),
  (error) => ({ ok: false, error }),
);
const count = async (table) => Number((await sql(`SELECT count(*) AS n FROM "${table}"`))[0].n);

describe("concurrency (E5-01 through the service): 20 transfers of 1 unit against a stock of 10", () => {
  it("gives exactly 10 successes, the right final stock and the right number of movements", async () => {
    await createStockLevel(world.organizations.A, from, productId, 10);

    const results = await runConcurrently(20, () => run(from, to, [{ productId, quantity: 1 }]));

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const refused = results.filter((r) => !r.ok);
    expect(refused.map((r) => [r.error.status, r.error.code, r.error.details?.productId])).toEqual(Array(10).fill([409, "INSUFFICIENT_STOCK", productId]));

    expect(await quantityOf(from, productId)).toBe(0);
    expect(await quantityOf(to, productId)).toBe(10);
    const [{ out, into }] = await sql(
      `SELECT count(*) FILTER (WHERE type = 'TRANSFER_OUT') AS out, count(*) FILTER (WHERE type = 'TRANSFER_IN') AS into FROM "StockMovements"`,
    );
    expect([Number(out), Number(into)]).toEqual([10, 10]);
    expect(await ledgerSum(from, productId)).toBe(-10);
    expect(await ledgerSum(to, productId)).toBe(10);
    expect((await sql(`SELECT code FROM "StockTransfers" ORDER BY code`)).map((row) => row.code)).toEqual(
      Array.from({ length: 10 }, (_, i) => `MT-${String(i + 1).padStart(4, "0")}`),
    );
  });

  it("queues transfers of different products on the warehouse lock: 20 succeed with 20 distinct sequential codes", async () => {
    // Each transfer owns its own stock row, so only the warehouse lock puts them in line. Without it
    // they all count the same number of transfers, collide on the code and run out of retries.
    const ids = [];
    for (let i = 0; i < 20; i += 1) {
      const id = await world.createProduct("A");
      await createStockLevel(world.organizations.A, from, id, 5);
      ids.push(id);
    }

    const results = await runConcurrently(20, (i) => run(from, to, [{ productId: ids[i], quantity: 1 }]));

    expect(results.filter((r) => !r.ok).map((r) => r.error.message)).toEqual([]);
    expect((await sql(`SELECT code FROM "StockTransfers" ORDER BY code`)).map((row) => row.code)).toEqual(
      Array.from({ length: 20 }, (_, i) => `MT-${String(i + 1).padStart(4, "0")}`),
    );
    expect(await count("StockMovements")).toBe(40);
  });

  it("loses nothing when opposite transfers run together (20 each way, no deadlock, totals conserved)", async () => {
    await createStockLevel(world.organizations.A, from, productId, 100);
    await createStockLevel(world.organizations.A, to, productId, 100);

    const results = await Promise.all([
      runConcurrently(20, () => run(from, to, [{ productId, quantity: 1 }])),
      runConcurrently(20, () => run(to, from, [{ productId, quantity: 1 }])),
    ]);

    expect(results.flat().filter((r) => !r.ok).map((r) => r.error.message)).toEqual([]);
    expect((await quantityOf(from, productId)) + (await quantityOf(to, productId))).toBe(200);
    expect(await quantityOf(from, productId)).toBe(100);
    expect(await count("StockTransfers")).toBe(40);
    expect(await count("StockMovements")).toBe(80);
  });
});

describe("atomicity (E5-02 through the service): an error after the source decrement", () => {
  it("leaves the source unchanged and writes no movement, destination row or transfer", async () => {
    const other = await world.createProduct("A");
    for (const id of [productId, other]) await createStockLevel(world.organizations.A, from, id, 10);

    const result = await withFailingStockLevelInsert(() => run(from, to, [{ productId, quantity: 3 }, { productId: other, quantity: 3 }]));

    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/stock level insert failed on purpose/);
    expect([await quantityOf(from, productId), await quantityOf(from, other)]).toEqual([10, 10]);
    expect(await count("StockMovements")).toBe(0);
    expect(await count("StockTransfers")).toBe(0);
    expect(await quantityOf(to, productId)).toBeUndefined();

    // Nothing was kept, so the same transfer works at once afterwards.
    expect((await run(from, to, [{ productId, quantity: 3 }, { productId: other, quantity: 3 }])).ok).toBe(true);
    expect(await quantityOf(to, other)).toBe(3);
  });
});
