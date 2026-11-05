const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { lockWarehouse } = require("../services/warehouseLock");

jest.setTimeout(60000);

let world;
let ctxA;
let warehouseId;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctxA = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  warehouseId = await world.createWarehouse("A");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("lockWarehouse", () => {
  it("returns the warehouse row of the caller's organization", async () => {
    const row = await inTransaction((transaction) => lockWarehouse(ctxA, warehouseId, transaction));
    expect(row.id).toBe(warehouseId);
    expect(row.organizationId).toBe(world.organizations.A);
  });

  it("returns null for a warehouse that does not exist or belongs to another organization", async () => {
    const foreign = await world.createWarehouse("B");
    const [missing, other] = await inTransaction(async (transaction) => [
      await lockWarehouse(ctxA, "33333333-3333-4333-8333-333333333333", transaction),
      await lockWarehouse(ctxA, foreign, transaction),
    ]);
    expect(missing).toBeNull();
    expect(other).toBeNull();
  });

  it("refuses to run without a transaction, because the lock would be released at once", async () => {
    await expect(lockWarehouse(ctxA, warehouseId, undefined)).rejects.toThrow(/inside a transaction/);
  });

  it("makes a second locker of the same warehouse wait until the first transaction ends", async () => {
    const events = [];
    let release;
    const hold = new Promise((resolve) => (release = resolve));
    let firstHasLock;
    const locked = new Promise((resolve) => (firstHasLock = resolve));

    const first = inTransaction(async (transaction) => {
      await lockWarehouse(ctxA, warehouseId, transaction);
      events.push("first locked");
      firstHasLock();
      await hold;
      events.push("first commits");
    });
    await locked;
    const second = inTransaction(async (transaction) => {
      await lockWarehouse(ctxA, warehouseId, transaction);
      events.push("second locked");
    });

    await sleep(400); // long enough for the second request to reach the database and queue
    expect(events).toEqual(["first locked"]);
    release();
    await Promise.all([first, second]);

    expect(events).toEqual(["first locked", "first commits", "second locked"]);
  });

  it("does not make lockers of different warehouses wait for each other", async () => {
    const other = await world.createWarehouse("A");
    let release;
    const hold = new Promise((resolve) => (release = resolve));
    let firstHasLock;
    const locked = new Promise((resolve) => (firstHasLock = resolve));

    const first = inTransaction(async (transaction) => {
      await lockWarehouse(ctxA, warehouseId, transaction);
      firstHasLock();
      await hold;
    });
    await locked;

    const row = await inTransaction((transaction) => lockWarehouse(ctxA, other, transaction));
    expect(row.id).toBe(other);
    release();
    await first;
  });
});
