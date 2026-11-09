const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { inTransaction } = require("../helpers/transaction");
const memberService = require("../services/memberService");
const warehouseService = require("../services/warehouseService");
const { lockWarehouse } = require("../services/warehouseLock");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");

jest.setTimeout(60000);

// Closes the E4-02 debt for the PATCH path: a change of a member's assignment and an archive of a
// warehouse at the same moment (docs/04, PATCH /api/members/:id). Same invariant as the PUT of
// /api/warehouses/:id/members: either the assignment came first (a row exists and the call succeeded)
// or the archive did (404 and no row). Never a row on a warehouse that was archived first.

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
const rowsOf = (warehouseId) => sql('SELECT * FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId', { warehouseId });
const archive = (id) => warehouseService.updateWarehouse(ctx, id, { archived: true });

// Holds the warehouse lock inside an open transaction until release() is called.
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
const track = (promise) => {
  const state = { settled: false, promise };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
};

describe("a PATCH of the assignment racing an archive", () => {
  it("does not assign anyone to a warehouse that was archived first: 404 and no row", async () => {
    const warehouseId = await world.createWarehouse("A");
    const viewer = world.users.A.VIEWER.id;
    const archiver = holdLock(warehouseId, (transaction) =>
      getSequelize().query('UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :warehouseId', { replacements: { warehouseId }, transaction }),
    );
    await archiver.locked;

    const patching = track(memberService.update(ctx, viewer, { warehouseIds: [warehouseId] }));
    await sleep(400);
    expect(patching.settled).toBe(false); // it waits for the lock

    archiver.release();
    await archiver.done;
    await expect(patching.promise).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(await rowsOf(warehouseId)).toHaveLength(0);
  });

  it("an archive that arrives while the PATCH holds the lock waits, and finds the assignment complete", async () => {
    const warehouseId = await world.createWarehouse("A");
    const viewer = world.users.A.VIEWER.id;
    const holder = holdLock(warehouseId);
    await holder.locked;

    const patching = track(memberService.update(ctx, viewer, { warehouseIds: [warehouseId] }));
    await sleep(300);
    const archiving = track(archive(warehouseId));
    await sleep(300);
    expect(patching.settled).toBe(false);
    expect(archiving.settled).toBe(false);

    holder.release();
    await holder.done;
    await patching.promise;
    await archiving.promise;
    expect(await rowsOf(warehouseId)).toHaveLength(1);
  });

  it("together, in every order, leaves a consistent warehouse (HTTP, 8 rounds)", async () => {
    const owner = `Bearer ${signToken(world.users.A.OWNER.id)}`;
    const viewer = world.users.A.VIEWER.id;

    for (let round = 0; round < 8; round += 1) {
      const warehouseId = await world.createWarehouse("A");

      const [patched, archived] = await Promise.all([
        request(app).patch(`/api/members/${viewer}`).set("Authorization", owner).send({ warehouseIds: [warehouseId] }),
        request(app).patch(`/api/warehouses/${warehouseId}`).set("Authorization", owner).send({ archived: true }),
      ]);

      expect(archived.status).toBe(200); // no stock, so the archive always succeeds
      const rows = await rowsOf(warehouseId);
      if (patched.status === 200) expect(rows).toHaveLength(1);
      else {
        expect(patched.status).toBe(404);
        expect(rows).toHaveLength(0);
      }
      await sql('DELETE FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId', { warehouseId });
    }
  });

  it("two simultaneous PATCHes of one member end with exactly one of the two lists", async () => {
    const [w1, w2] = [await world.createWarehouse("A"), await world.createWarehouse("A")];
    const viewer = world.users.A.VIEWER.id;

    for (let round = 0; round < 6; round += 1) {
      await Promise.all([memberService.update(ctx, viewer, { warehouseIds: [w1] }), memberService.update(ctx, viewer, { warehouseIds: [w2] })]);

      const rows = (await sql('SELECT "warehouseId" FROM "UserWarehouses" WHERE "userId" = :viewer', { viewer })).map((r) => r.warehouseId);
      expect([[w1], [w2]]).toContainEqual(rows);
    }
  });
});
