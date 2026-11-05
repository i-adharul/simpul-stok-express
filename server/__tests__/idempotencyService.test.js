const crypto = require("crypto");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { tenant } = require("../helpers/tenantScope");
const idempotencyService = require("../services/idempotencyService");

jest.setTimeout(60000);

let world;
let ctxA;
let ctxB;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctxA = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  ctxB = { userId: world.users.B.OWNER.id, organizationId: world.organizations.B, role: "OWNER", warehouseIds: [] };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const ENDPOINT = "POST /api/test/things";
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const countWarehouses = async (organizationId) =>
  Number((await sql(`SELECT count(*) AS n FROM "Warehouses" WHERE "organizationId" = :organizationId`, { organizationId }))[0].n);
const keyRows = (organizationId) => sql(`SELECT * FROM "IdempotencyKeys" WHERE "organizationId" = :organizationId`, { organizationId });

// The "business effect" of these tests: one warehouse row, written inside the transaction.
const makeWork = (ctx, code = "GD-1") => {
  const work = jest.fn(async (transaction) => (await tenant(ctx).Warehouse.create({ code, name: code }, { transaction })).id);
  return work;
};

describe("idempotencyService.run: first call and pre-check", () => {
  it("runs work once, stores the key row with the resource ID and reports replayed: false", async () => {
    const key = crypto.randomUUID();
    const work = makeWork(ctxA);

    const result = await idempotencyService.run(ctxA, { key, endpoint: ENDPOINT }, { work });

    expect(work).toHaveBeenCalledTimes(1);
    expect(result.replayed).toBe(false);
    const rows = await keyRows(ctxA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key, endpoint: ENDPOINT, resourceId: result.resourceId });
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
  });

  it("does not run work again for a stored key and returns the stored resource ID", async () => {
    const key = crypto.randomUUID();
    const first = await idempotencyService.run(ctxA, { key, endpoint: ENDPOINT }, { work: makeWork(ctxA) });
    const work = makeWork(ctxA, "GD-2");

    const second = await idempotencyService.run(ctxA, { key, endpoint: ENDPOINT }, { work });

    expect(work).not.toHaveBeenCalled();
    expect(second).toEqual({ replayed: true, resourceId: first.resourceId });
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
  });

  it("treats the same key on another endpoint as a different key", async () => {
    const key = crypto.randomUUID();
    await idempotencyService.run(ctxA, { key, endpoint: ENDPOINT }, { work: makeWork(ctxA, "GD-1") });
    const other = await idempotencyService.run(ctxA, { key, endpoint: "POST /api/test/other" }, { work: makeWork(ctxA, "GD-2") });

    expect(other.replayed).toBe(false);
    expect(await countWarehouses(ctxA.organizationId)).toBe(2);
  });

  it("treats the same key in another organization as a different key", async () => {
    const key = crypto.randomUUID();
    await idempotencyService.run(ctxA, { key, endpoint: ENDPOINT }, { work: makeWork(ctxA) });
    const other = await idempotencyService.run(ctxB, { key, endpoint: ENDPOINT }, { work: makeWork(ctxB) });

    expect(other.replayed).toBe(false);
    expect(await countWarehouses(ctxB.organizationId)).toBe(1);
    expect(await keyRows(ctxB.organizationId)).toHaveLength(1);
  });
});

describe("idempotencyService.run: the effect and the key are one transaction", () => {
  it("rolls the effect back and stores no key when the key row cannot be written", async () => {
    const work = jest.fn(async (transaction) => {
      await tenant(ctxA).Warehouse.create({ code: "GD-X", name: "x" }, { transaction });
      return "not-a-uuid"; // the key insert rejects it, after the warehouse was written
    });

    await expect(idempotencyService.run(ctxA, { key: crypto.randomUUID(), endpoint: ENDPOINT }, { work })).rejects.toThrow();

    expect(await countWarehouses(ctxA.organizationId)).toBe(0);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(0);
  });

  it("refuses a work function that returns no resource ID", async () => {
    await expect(
      idempotencyService.run(ctxA, { key: crypto.randomUUID(), endpoint: ENDPOINT }, { work: async () => undefined }),
    ).rejects.toThrow(/resource ID/);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(0);
  });
});
