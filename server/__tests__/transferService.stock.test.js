const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { MAX_QUANTITY } = require("../services/stockService");
const { moveStock } = require("../services/transferService");
const { quantityOf, levelRows } = require("./support/stockProof");

let world;
let ctx;
let from;
let to;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  from = await world.createWarehouse("A");
  to = await world.createWarehouse("A");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

// Products sorted by ID, so "the first item" in the assertions is the first in productId order.
const makeProducts = async (n) => (await Promise.all(Array.from({ length: n }, () => world.createProduct("A")))).sort();
const stock = (warehouseId, productId, quantity) => createStockLevel(world.organizations.A, warehouseId, productId, quantity);
const move = (items) => inTransaction((t) => moveStock(ctx, { fromWarehouseId: from, toWarehouseId: to, items }, t));
const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return { status: error.status, code: error.code, details: error.details };
  }
  return null;
};

describe("moveStock: success", () => {
  it("decrements the source, creates the missing destination row and increases an existing one", async () => {
    const [p1, p2] = await makeProducts(2);
    await stock(from, p1, 10);
    await stock(from, p2, 4);
    await stock(to, p2, 5);

    await move([{ productId: p1, quantity: 3 }, { productId: p2, quantity: 4 }]);

    expect([await quantityOf(from, p1), await quantityOf(from, p2)]).toEqual([7, 0]);
    expect([await quantityOf(to, p1), await quantityOf(to, p2)]).toEqual([3, 9]);
    expect(await levelRows(to, p1)).toBe(1);
  });

  it("can take the whole stock (the condition is quantity >= n, so exactly equal passes)", async () => {
    const [p1] = await makeProducts(1);
    await stock(from, p1, 5);
    await move([{ productId: p1, quantity: 5 }]);
    expect(await quantityOf(from, p1)).toBe(0);
    expect(await quantityOf(to, p1)).toBe(5);
  });
});

describe("moveStock: insufficient stock (409, nothing written)", () => {
  it("refuses one unit more than the source holds", async () => {
    const [p1] = await makeProducts(1);
    await stock(from, p1, 5);
    expect(await failure(move([{ productId: p1, quantity: 6 }]))).toEqual({ status: 409, code: "INSUFFICIENT_STOCK", details: { productId: p1 } });
    expect(await quantityOf(from, p1)).toBe(5);
  });

  it("refuses a product the source has no row for", async () => {
    const [p1] = await makeProducts(1);
    expect(await failure(move([{ productId: p1, quantity: 1 }]))).toEqual({ status: 409, code: "INSUFFICIENT_STOCK", details: { productId: p1 } });
    expect(await levelRows(from, p1)).toBe(0);
  });

  it("names the first item in productId order that the source cannot cover, and rolls back the earlier decrements", async () => {
    const [p1, p2, p3] = await makeProducts(3);
    for (const p of [p1, p2, p3]) await stock(from, p, 5);

    const error = await failure(move([{ productId: p1, quantity: 2 }, { productId: p2, quantity: 9 }, { productId: p3, quantity: 9 }]));

    expect(error).toEqual({ status: 409, code: "INSUFFICIENT_STOCK", details: { productId: p2 } });
    expect([await quantityOf(from, p1), await quantityOf(from, p2), await quantityOf(from, p3)]).toEqual([5, 5, 5]);
  });

  it("never touches the destination: no row is created and an existing one is unchanged", async () => {
    const [p1, p2] = await makeProducts(2);
    await stock(from, p1, 5);
    await stock(from, p2, 1);
    await stock(to, p1, 7);

    await failure(move([{ productId: p1, quantity: 2 }, { productId: p2, quantity: 2 }]));

    expect(await quantityOf(to, p1)).toBe(7);
    expect(await levelRows(to, p2)).toBe(0);
  });
});

describe("moveStock: the destination column limit (409, nothing written)", () => {
  it("refuses a destination total above 2,147,483,647 and leaves the source unchanged", async () => {
    const [p1, p2] = await makeProducts(2);
    await stock(from, p1, 5);
    await stock(from, p2, 5);
    await stock(to, p2, MAX_QUANTITY);

    expect(await failure(move([{ productId: p1, quantity: 1 }, { productId: p2, quantity: 1 }]))).toMatchObject({ status: 409, code: "CONFLICT" });

    expect([await quantityOf(from, p1), await quantityOf(from, p2)]).toEqual([5, 5]);
    expect(await levelRows(to, p1)).toBe(0);
    expect(await quantityOf(to, p2)).toBe(MAX_QUANTITY);
  });

  it("accepts a total of exactly 2,147,483,647", async () => {
    const [p1] = await makeProducts(1);
    await stock(from, p1, 1);
    await stock(to, p1, MAX_QUANTITY - 1);
    await move([{ productId: p1, quantity: 1 }]);
    expect(await quantityOf(to, p1)).toBe(MAX_QUANTITY);
  });
});
