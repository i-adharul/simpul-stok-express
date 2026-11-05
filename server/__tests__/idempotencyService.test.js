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

// What the caller of run() supplies besides `work`: load the resource and say who may see it.
const load = async (id) => {
  const rows = await sql(`SELECT id, code, name FROM "Warehouses" WHERE id = :id`, { id });
  return rows[0] ?? null;
};
const everyone = () => true;
const call = (ctx, key, work, { endpoint = ENDPOINT, ...rest } = {}) =>
  idempotencyService.run(ctx, { key, endpoint }, { work, load, access: everyone, ...rest });

// The "business effect" of these tests: one warehouse row, written inside the transaction.
const makeWork = (ctx, code = "GD-1") => {
  const work = jest.fn(async (transaction) => (await tenant(ctx).Warehouse.create({ code, name: code }, { transaction })).id);
  return work;
};

describe("idempotencyService.run: first call and pre-check", () => {
  it("runs work once, stores the key row with the resource ID and reports replayed: false", async () => {
    const key = crypto.randomUUID();
    const work = makeWork(ctxA);

    const result = await call(ctxA, key, work, { endpoint: ENDPOINT });

    expect(work).toHaveBeenCalledTimes(1);
    expect(result.replayed).toBe(false);
    const rows = await keyRows(ctxA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key, endpoint: ENDPOINT, resourceId: result.body.id });
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
  });

  it("does not run work again for a stored key and returns the stored resource ID", async () => {
    const key = crypto.randomUUID();
    const first = await call(ctxA, key, makeWork(ctxA), { endpoint: ENDPOINT });
    const work = makeWork(ctxA, "GD-2");

    const second = await call(ctxA, key, work, { endpoint: ENDPOINT });

    expect(work).not.toHaveBeenCalled();
    expect(second).toEqual({ replayed: true, body: first.body });
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
  });

  it("treats the same key on another endpoint as a different key", async () => {
    const key = crypto.randomUUID();
    await call(ctxA, key, makeWork(ctxA, "GD-1"), { endpoint: ENDPOINT });
    const other = await call(ctxA, key, makeWork(ctxA, "GD-2"), { endpoint: "POST /api/test/other" });

    expect(other.replayed).toBe(false);
    expect(await countWarehouses(ctxA.organizationId)).toBe(2);
  });

  it("treats the same key in another organization as a different key", async () => {
    const key = crypto.randomUUID();
    await call(ctxA, key, makeWork(ctxA), { endpoint: ENDPOINT });
    const other = await call(ctxB, key, makeWork(ctxB), { endpoint: ENDPOINT });

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

    await expect(call(ctxA, crypto.randomUUID(), work, { endpoint: ENDPOINT })).rejects.toThrow();

    expect(await countWarehouses(ctxA.organizationId)).toBe(0);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(0);
  });

  it("refuses a work function that returns no resource ID", async () => {
    await expect(
      call(ctxA, crypto.randomUUID(), async () => undefined, { endpoint: ENDPOINT }),
    ).rejects.toThrow(/resource ID/);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(0);
  });
});

describe("idempotencyService.run: a twin that finished first", () => {
  // Both calls pass the pre-check (no key yet) and both reach `work` before either writes. The
  // gate holds them there, so the race is the same on every run.
  const raceWork = (ctx, code) => {
    let started = 0;
    let open;
    const gate = new Promise((resolve) => (open = resolve));
    return () =>
      jest.fn(async (transaction) => {
        started += 1;
        if (started === 2) open();
        await gate;
        return (await tenant(ctx).Warehouse.create({ code, name: code }, { transaction })).id;
      });
  };

  it("answers the loser as a replay when its work fails on a business rule after the twin committed", async () => {
    const key = crypto.randomUUID();
    const makeRaceWork = raceWork(ctxA, "GD-RACE"); // the second insert breaks the unique warehouse code

    const results = await Promise.all([
      call(ctxA, key, makeRaceWork(), { endpoint: ENDPOINT }),
      call(ctxA, key, makeRaceWork(), { endpoint: ENDPOINT }),
    ]);

    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0].body).toEqual(results[1].body);
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(1);
  });

  it("throws the original error when the failure left no key", async () => {
    const boom = new Error("boom");
    const work = jest.fn(async () => {
      throw boom;
    });

    await expect(call(ctxA, crypto.randomUUID(), work, { endpoint: ENDPOINT })).rejects.toBe(boom);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(0);
  });

  it("allows the same key again after a failed request", async () => {
    const key = crypto.randomUUID();
    await expect(
      call(ctxA, key, async () => { throw new Error("first fails"); }),
    ).rejects.toThrow("first fails");

    const retry = await call(ctxA, key, makeWork(ctxA), { endpoint: ENDPOINT });

    expect(retry.replayed).toBe(false);
    expect(await countWarehouses(ctxA.organizationId)).toBe(1);
  });
});

describe("idempotencyService.run: the answer is built from load()", () => {
  it("builds the body of the first call and of a replay from load(resourceId): they are equal", async () => {
    const key = crypto.randomUUID();
    const loadSpy = jest.fn(load);

    const first = await call(ctxA, key, makeWork(ctxA, "GD-L"), { load: loadSpy });
    const replay = await call(ctxA, key, makeWork(ctxA, "GD-M"), { load: loadSpy });

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenNthCalledWith(1, first.body.id);
    expect(first.body).toMatchObject({ code: "GD-L" });
    expect(replay).toEqual({ replayed: true, body: first.body });
    expect(first.replayed).toBe(false);
  });

  it("does not ask access() on the first call: the handler authorized before running", async () => {
    const access = jest.fn(() => false);
    const result = await call(ctxA, crypto.randomUUID(), makeWork(ctxA), { access });
    expect(result.replayed).toBe(false);
    expect(access).not.toHaveBeenCalled();
  });

  it("authorizes a replay again: access(ctx, body) receives the loaded resource", async () => {
    const key = crypto.randomUUID();
    const first = await call(ctxA, key, makeWork(ctxA));
    const access = jest.fn(() => true);

    await call(ctxA, key, makeWork(ctxA), { access });

    expect(access).toHaveBeenCalledWith(ctxA, first.body);
  });

  it("answers a replay the caller may not see with the same 404 as a missing resource", async () => {
    const key = crypto.randomUUID();
    await call(ctxA, key, makeWork(ctxA));

    const error = await call(ctxA, key, makeWork(ctxA), { access: () => false }).catch((e) => e);

    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404, message: "Data tidak ditemukan." });
  });

  it("answers 404 when the stored resource can no longer be loaded", async () => {
    const key = crypto.randomUUID();
    await call(ctxA, key, makeWork(ctxA));

    const error = await call(ctxA, key, makeWork(ctxA), { load: async () => null }).catch((e) => e);

    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not store a second key when the replay is refused", async () => {
    const key = crypto.randomUUID();
    await call(ctxA, key, makeWork(ctxA));
    await call(ctxA, key, makeWork(ctxA), { access: () => false }).catch(() => null);
    expect(await keyRows(ctxA.organizationId)).toHaveLength(1);
  });
});
