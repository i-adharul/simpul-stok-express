const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { inTransaction, inSavepoint } = require("../helpers/transaction");
const { createWithCode, MAX_CODE_RETRIES } = require("../services/transferCode");

jest.setTimeout(60000);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const values = () => ({ fromWarehouseId: from, toWarehouseId: to, note: null, createdById: ctx.userId });
const codes = async () => (await getSequelize().query(`SELECT code FROM "StockTransfers" ORDER BY code`))[0].map((row) => row.code);
const insertRow = (code) =>
  getSequelize().query(`INSERT INTO "StockTransfers" ("organizationId", code, "fromWarehouseId", "toWarehouseId") VALUES (:o, :code, :from, :to)`, {
    replacements: { o: world.organizations.A, code, from, to },
  });

const insertRowIn = (transaction, code) =>
  getSequelize().query(`INSERT INTO "StockTransfers" ("organizationId", code, "fromWarehouseId", "toWarehouseId") VALUES (:o, :code, :from, :to)`, {
    replacements: { o: world.organizations.A, code, from, to },
    transaction,
  });

describe("inSavepoint", () => {
  it("rolls back only its own work and leaves the outer transaction usable", async () => {
    await inTransaction(async (t) => {
      await insertRowIn(t, "MT-0001");
      await expect(inSavepoint(t, async (sp) => { await insertRowIn(sp, "MT-0002"); throw new Error("boom"); })).rejects.toThrow("boom");
      await insertRowIn(t, "MT-0003");
    });
    expect(await codes()).toEqual(["MT-0001", "MT-0003"]);
  });
});
describe("createWithCode", () => {
  it("writes the row with the next code and returns it", async () => {
    const first = await inTransaction((t) => createWithCode(ctx, values(), t));
    const second = await inTransaction((t) => createWithCode(ctx, values(), t));
    expect([first.code, second.code]).toEqual(["MT-0001", "MT-0002"]);
    expect(first).toMatchObject({ organizationId: ctx.organizationId, fromWarehouseId: from, toWarehouseId: to, createdById: ctx.userId });
    expect(await codes()).toEqual(["MT-0001", "MT-0002"]);
  });

  it("retries with a fresh count after a collision with a transfer that commits meanwhile", async () => {
    const waits = jest.fn(async () => {});
    const holder = await db.sequelize.transaction();
    await createWithCode(ctx, values(), holder); // uncommitted MT-0001: the other transaction cannot see it

    const racing = inTransaction((t) => createWithCode(ctx, values(), t, { wait: waits })); // counts 0, proposes MT-0001
    await sleep(300); // it waits on the unique index
    await holder.commit();
    const second = await racing;

    expect(second.code).toBe("MT-0002");
    expect(waits).toHaveBeenCalledTimes(1);
    expect(await codes()).toEqual(["MT-0001", "MT-0002"]);
  });

  it("keeps the rest of the transaction when only the insert is retried", async () => {
    const holder = await db.sequelize.transaction();
    await createWithCode(ctx, values(), holder);
    const racing = inTransaction(async (t) => {
      await insertRowIn(t, "MT-0099"); // work done earlier in the same transaction
      return createWithCode(ctx, values(), t, { wait: async () => {} });
    });
    await sleep(300);
    await holder.commit();
    await racing;
    expect(await codes()).toEqual(["MT-0001", "MT-0002", "MT-0099"]);
  });

  it("gives up with 409 and a clear message when retries run out", async () => {
    // A gap that real data never has: one row coded MT-0002 means count + 1 = 2 collides every time.
    await insertRow("MT-0002");
    const wait = jest.fn(async () => {});

    const error = await inTransaction((t) => createWithCode(ctx, values(), t, { wait })).catch((e) => e);

    expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: "Terlalu banyak mutasi bersamaan, coba lagi." });
    expect(wait).toHaveBeenCalledTimes(MAX_CODE_RETRIES);
    expect(MAX_CODE_RETRIES).toBe(5);
    expect(await codes()).toEqual(["MT-0002"]);
  });

  it("does not hide a failure that is not a code collision", async () => {
    const wait = jest.fn(async () => {});
    const bad = { ...values(), toWarehouseId: from }; // CHECK from <> to
    await expect(inTransaction((t) => createWithCode(ctx, bad, t, { wait }))).rejects.not.toMatchObject({ status: 409 });
    expect(wait).not.toHaveBeenCalled();
  });

  it("gives every one of 4 simultaneous transfers its own code, MT-0001 to MT-0004", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => inTransaction((t) => createWithCode(ctx, values(), t))));
    expect(results.map((r) => r.code).sort()).toEqual(["MT-0001", "MT-0002", "MT-0003", "MT-0004"]);
    expect(await codes()).toEqual(["MT-0001", "MT-0002", "MT-0003", "MT-0004"]);
  });
});
