const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { lockWarehouse } = require("../services/warehouseLock");
const { lockBothWarehouses, prepareTransfer } = require("../services/transferService");

jest.setTimeout(60000);

// ADR 0014: a transfer locks both warehouses in ascending ID order before it reads anything.
let world;
let ctx;
let low;
let high;
let productId;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  [low, high] = [await world.createWarehouse("A"), await world.createWarehouse("A")].sort();
  productId = await world.createProduct("A");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const input = (from, to) => ({ fromWarehouseId: from, toWarehouseId: to, items: [{ productId, quantity: 1 }] });

// Is the warehouse row free right now? NOWAIT fails at once if another transaction holds the row.
async function isFree(warehouseId) {
  const transaction = await db.sequelize.transaction();
  try {
    await db.sequelize.query(`SELECT id FROM "Warehouses" WHERE id = :warehouseId FOR UPDATE NOWAIT`, { replacements: { warehouseId }, transaction });
    return true;
  } catch {
    return false;
  } finally {
    await transaction.rollback();
  }
}

describe("lockBothWarehouses", () => {
  it("returns the source and the destination rows, whichever has the smaller ID", async () => {
    for (const [from, to] of [[low, high], [high, low]]) {
      const { source, destination } = await inTransaction((t) => lockBothWarehouses(ctx, input(from, to), t));
      expect([source.id, destination.id]).toEqual([from, to]);
    }
  });

  it("returns null for a destination of another organization or one that does not exist", async () => {
    const foreign = await world.createWarehouse("B");
    const { source, destination } = await inTransaction((t) => lockBothWarehouses(ctx, input(low, foreign), t));
    expect(source.id).toBe(low);
    expect(destination).toBeNull();
  });

  it("refuses to run without a transaction (the locks would be released at once)", async () => {
    await expect(lockBothWarehouses(ctx, input(low, high), undefined)).rejects.toThrow(/inside a transaction/);
  });

  it.each([
    ["source has the larger ID", () => [high, low]],
    ["source has the smaller ID", () => [low, high]],
  ])("takes the smaller ID first and does not hold the larger one while it waits (%s)", async (_name, pair) => {
    const [from, to] = pair();
    const holder = await db.sequelize.transaction();
    await lockWarehouse(ctx, low, holder); // another writer holds the smaller ID

    let finished = false;
    const waiting = inTransaction(async (t) => {
      await lockBothWarehouses(ctx, input(from, to), t);
      finished = true;
    });
    let freeWhileWaiting;
    try {
      await sleep(300);
      freeWhileWaiting = await isFree(high);
      expect(finished).toBe(false); // blocked on the smaller ID
    } finally {
      await holder.rollback(); // always released, so a failing assertion cannot hang the suite
    }
    await waiting;

    expect(freeWhileWaiting).toBe(true); // it did not hold the larger ID while it waited: not locked first
    expect(finished).toBe(true);
  });
});

describe("opposite transfers do not deadlock", () => {
  it("20 rounds of A to B against B to A, each holding its locks for a while, all succeed", async () => {
    const hold = (from, to) =>
      inTransaction(async (t) => {
        await prepareTransfer(ctx, input(from, to), t);
        await sleep(15); // keep both locks long enough for a wrong order to collide
      });

    for (let round = 0; round < 20; round += 1) {
      const results = await Promise.allSettled([hold(low, high), hold(high, low), hold(low, high), hold(high, low)]);
      expect(results.filter((r) => r.status === "rejected").map((r) => r.reason.message)).toEqual([]);
    }
  });
});

describe("prepareTransfer", () => {
  it("returns the locked rows and the items ordered by productId", async () => {
    const other = await world.createProduct("A");
    const items = [{ productId, quantity: 2 }, { productId: other, quantity: 1 }];
    const result = await inTransaction((t) => prepareTransfer(ctx, { fromWarehouseId: low, toWarehouseId: high, items }, t));
    expect(result.items.map((i) => i.productId)).toEqual([productId, other].sort());
    expect([result.source.id, result.destination.id]).toEqual([low, high]);
  });

  it("reads archivedAt only under the locks: an archived destination is a 409", async () => {
    await getSequelize().query(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :high`, { replacements: { high } });
    await expect(inTransaction((t) => prepareTransfer(ctx, input(low, high), t))).rejects.toMatchObject({ status: 409 });
  });

  it("answers 404 for a foreign destination and 403 for a foreign source", async () => {
    const foreign = await world.createWarehouse("B");
    await expect(inTransaction((t) => prepareTransfer(ctx, input(low, foreign), t))).rejects.toMatchObject({ status: 404 });
    await expect(inTransaction((t) => prepareTransfer(ctx, input(foreign, low), t))).rejects.toMatchObject({ status: 403 });
  });

  it("stops a bad shape before any lock is taken", async () => {
    await expect(prepareTransfer(ctx, input(low, low), undefined)).rejects.toMatchObject({ status: 400 });
  });
});
