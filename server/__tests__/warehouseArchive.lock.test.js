const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const stockService = require("../services/stockService");
const warehouseService = require("../services/warehouseService");
const warehouseMemberService = require("../services/warehouseMemberService");
const { lockWarehouse } = require("../services/warehouseLock");

jest.setTimeout(60000);

let world;
let ctx;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const archive = (id) => warehouseService.updateWarehouse(ctx, id, { archived: true });
const restore = (id) => warehouseService.updateWarehouse(ctx, id, { archived: false });
const isArchived = async (id) => (await sql(`SELECT "archivedAt" FROM "Warehouses" WHERE id = :id`, { id }))[0].archivedAt !== null;
const stockOf = async (warehouseId) =>
  Number((await sql(`SELECT COALESCE(sum(quantity), 0) AS n FROM "StockLevels" WHERE "warehouseId" = :warehouseId`, { warehouseId }))[0].n);

// Holds the warehouse lock inside an open transaction until release() is called, and resolves once
// the lock is taken. `then` runs inside the transaction after the lock, before the hold.
function holdLock(warehouseId, then = async () => {}) {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let held;
  const locked = new Promise((resolve) => (held = resolve));
  const done = inTransaction(async (transaction) => {
    await lockWarehouse(ctx, warehouseId, transaction);
    await then(transaction);
    held();
    await gate;
  });
  return { locked, release, done };
}

// A promise settled flag, so a test can say "this call is still waiting".
const track = (promise) => {
  const state = { settled: false };
  state.promise = promise.finally(() => (state.settled = true));
  state.promise.catch(() => {});
  return state;
};

describe("archive and restore of a warehouse take the warehouse lock", () => {
  it("archive waits for a stock writer that holds the lock, then sees its stock and refuses with 409", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    const writer = holdLock(warehouseId, (transaction) => stockService.receive(ctx, { warehouseId, productId, quantity: 5 }, transaction));
    await writer.locked;

    const archiving = track(archive(warehouseId));
    await sleep(400);
    expect(archiving.settled).toBe(false); // it is queued behind the lock, not racing past the stock check

    writer.release();
    await writer.done;
    await expect(archiving.promise).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await stockOf(warehouseId)).toBe(5);
    expect(await isArchived(warehouseId)).toBe(false);
  });

  it("restore waits for the lock holder too", async () => {
    const warehouseId = await world.createWarehouse("A");
    await archive(warehouseId);
    const holder = holdLock(warehouseId);
    await holder.locked;

    const restoring = track(restore(warehouseId));
    await sleep(400);
    expect(restoring.settled).toBe(false);

    holder.release();
    await holder.done;
    await restoring.promise;
    expect(await isArchived(warehouseId)).toBe(false);
  });

  it("a stock writer queued behind an archive finds the warehouse archived: 409, nothing written", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    // Stands in for an archive in progress: the lock is held and the row is already marked.
    const archiver = holdLock(warehouseId, (transaction) =>
      getSequelize().query(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :warehouseId`, { replacements: { warehouseId }, transaction }),
    );
    await archiver.locked;

    const receiving = track(inTransaction((transaction) => stockService.receive(ctx, { warehouseId, productId, quantity: 5 }, transaction)));
    await sleep(400);
    expect(receiving.settled).toBe(false);

    archiver.release();
    await archiver.done;
    await expect(receiving.promise).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await stockOf(warehouseId)).toBe(0);
  });
});

describe("a receipt racing an archive (the invariant holds in every order)", () => {
  it("never leaves an archived warehouse that holds stock", async () => {
    for (let round = 0; round < 8; round += 1) {
      const warehouseId = await world.createWarehouse("A");
      const productId = await world.createProduct("A");

      const [received, archived] = await Promise.allSettled([
        inTransaction((transaction) => stockService.receive(ctx, { warehouseId, productId, quantity: 5 }, transaction)),
        archive(warehouseId),
      ]);

      // Exactly one order happened: receipt first (the archive is refused) or archive first (the receipt is refused).
      expect([received.status, archived.status].sort()).toEqual(["fulfilled", "rejected"]);
      expect(received.status === "fulfilled" ? archived.reason : received.reason).toMatchObject({ code: "CONFLICT", status: 409 });
      expect((await isArchived(warehouseId)) && (await stockOf(warehouseId)) > 0).toBe(false);
    }
  });
});

describe("assignment racing an archive", () => {
  it("does not assign anyone to a warehouse that was archived first: 404 and no row", async () => {
    const warehouseId = await world.createWarehouse("A");
    const viewer = world.users.A.VIEWER.id;
    const archiver = holdLock(warehouseId, (transaction) =>
      getSequelize().query(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :warehouseId`, { replacements: { warehouseId }, transaction }),
    );
    await archiver.locked;

    const assigning = track(warehouseMemberService.replaceMembers(ctx, warehouseId, [viewer]));
    await sleep(400);
    expect(assigning.settled).toBe(false);

    archiver.release();
    await archiver.done;
    await expect(assigning.promise).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await sql(`SELECT * FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId`, { warehouseId })).toHaveLength(0);
  });

  it("archive and assignment together leave a consistent warehouse in every order", async () => {
    for (let round = 0; round < 6; round += 1) {
      const warehouseId = await world.createWarehouse("A");
      const viewer = world.users.A.VIEWER.id;

      const [archived, assigned] = await Promise.allSettled([archive(warehouseId), warehouseMemberService.replaceMembers(ctx, warehouseId, [viewer])]);

      expect(archived.status).toBe("fulfilled"); // no stock, so the archive always succeeds
      const rows = await sql(`SELECT * FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId`, { warehouseId });
      // Either the assignment came first (a row exists and the call succeeded), or the archive did (404, no row).
      if (assigned.status === "fulfilled") expect(rows).toHaveLength(1);
      else {
        expect(assigned.reason).toMatchObject({ code: "NOT_FOUND" });
        expect(rows).toHaveLength(0);
      }
    }
  });
});
