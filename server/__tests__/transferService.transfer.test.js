const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { transfer, getTransfer } = require("../services/transferService");
const { sql, quantityOf, ledgerSum } = require("./support/stockProof");

let world;
let ctx;
let from;
let to;
let products;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  from = await world.createWarehouse("A", "SRC");
  to = await world.createWarehouse("A", "DST");
  products = (await Promise.all([world.createProduct("A"), world.createProduct("A"), world.createProduct("A")])).sort();
  for (const productId of products) await createStockLevel(world.organizations.A, from, productId, 10);
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const run = (input) => inTransaction((t) => transfer(ctx, { fromWarehouseId: from, toWarehouseId: to, ...input }, t));
const movements = () => sql(`SELECT * FROM "StockMovements" ORDER BY "productId", type`);

describe("transfer", () => {
  it("returns the ID of the new transfer and writes the header with the first code", async () => {
    const id = await run({ items: [{ productId: products[0], quantity: 3 }], note: "kirim" });

    const [header] = await sql(`SELECT * FROM "StockTransfers"`);
    expect(header).toMatchObject({ id, code: "MT-0001", fromWarehouseId: from, toWarehouseId: to, note: "kirim", createdById: ctx.userId });
  });

  it("writes a TRANSFER_OUT and a TRANSFER_IN per item with the same transferId and the right signs", async () => {
    const id = await run({ items: [{ productId: products[1], quantity: 4 }, { productId: products[0], quantity: 2 }] });

    const rows = await movements();
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.transferId === id && row.createdById === ctx.userId && row.reason === null && row.note === null)).toBe(true);
    const find = (productId, type) => rows.find((row) => row.productId === productId && row.type === type);
    expect(find(products[0], "TRANSFER_OUT")).toMatchObject({ warehouseId: from, quantityDelta: -2 });
    expect(find(products[0], "TRANSFER_IN")).toMatchObject({ warehouseId: to, quantityDelta: 2 });
    expect(find(products[1], "TRANSFER_OUT")).toMatchObject({ warehouseId: from, quantityDelta: -4 });
    expect(find(products[1], "TRANSFER_IN")).toMatchObject({ warehouseId: to, quantityDelta: 4 });
  });

  it("keeps stock and ledger in step: the sum of the movements equals the change of each stock row", async () => {
    await run({ items: [{ productId: products[0], quantity: 3 }, { productId: products[2], quantity: 10 }] });

    expect([await quantityOf(from, products[0]), await quantityOf(to, products[0])]).toEqual([7, 3]);
    expect([await quantityOf(from, products[2]), await quantityOf(to, products[2])]).toEqual([0, 10]);
    expect([await ledgerSum(from, products[0]), await ledgerSum(to, products[0])]).toEqual([-3, 3]);
  });

  it("numbers consecutive transfers MT-0001, MT-0002", async () => {
    await run({ items: [{ productId: products[0], quantity: 1 }] });
    await run({ items: [{ productId: products[0], quantity: 1 }] });
    expect((await sql(`SELECT code FROM "StockTransfers" ORDER BY code`)).map((row) => row.code)).toEqual(["MT-0001", "MT-0002"]);
  });

  it("stores a missing note as null", async () => {
    await run({ items: [{ productId: products[0], quantity: 1 }] });
    expect((await sql(`SELECT note FROM "StockTransfers"`))[0].note).toBeNull();
  });

  it("writes nothing at all when the stock is insufficient (header and movements included)", async () => {
    await expect(run({ items: [{ productId: products[0], quantity: 1 }, { productId: products[1], quantity: 11 }] })).rejects.toMatchObject({
      status: 409,
      code: "INSUFFICIENT_STOCK",
      details: { productId: products[1] },
    });

    expect(await movements()).toHaveLength(0);
    expect(await sql(`SELECT * FROM "StockTransfers"`)).toHaveLength(0);
    expect(await quantityOf(from, products[0])).toBe(10);
  });

  it("refuses a bad input before it writes anything (400)", async () => {
    await expect(run({ toWarehouseId: from, items: [{ productId: products[0], quantity: 1 }] })).rejects.toMatchObject({ status: 400 });
    expect(await sql(`SELECT * FROM "StockTransfers"`)).toHaveLength(0);
  });
});

describe("getTransfer: the answer comes from stored rows", () => {
  it("has the header and the items in productId order, with positive quantities", async () => {
    const id = await run({ items: [{ productId: products[2], quantity: 5 }, { productId: products[0], quantity: 1 }], note: "n" });

    const body = await getTransfer(ctx, id);

    expect(body).toEqual({
      id,
      code: "MT-0001",
      fromWarehouseId: from,
      toWarehouseId: to,
      items: [{ productId: products[0], quantity: 1 }, { productId: products[2], quantity: 5 }],
      note: "n",
      createdAt: expect.any(Date),
    });
  });

  it("does not change when the stock changes afterwards (no balance in it)", async () => {
    const id = await run({ items: [{ productId: products[0], quantity: 2 }] });
    const before = await getTransfer(ctx, id);
    await sql(`UPDATE "StockLevels" SET quantity = quantity + 100`);
    expect(await getTransfer(ctx, id)).toEqual(before);
  });

  it("is null for an unknown transfer and for another organization's transfer", async () => {
    const id = await run({ items: [{ productId: products[0], quantity: 1 }] });
    const other = { ...ctx, organizationId: world.organizations.B, userId: world.users.B.OWNER.id };
    expect(await getTransfer(other, id)).toBeNull();
    expect(await getTransfer(ctx, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")).toBeNull();
  });
});
