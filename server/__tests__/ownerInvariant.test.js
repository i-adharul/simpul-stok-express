// BL07: every organization keeps exactly one active Owner, whatever is done to its members. A fixed
// series of operations through the real endpoints (invite, accept, change role, deactivate, reset,
// invite again) and a longer pseudo-random series, with the rule checked after EVERY operation and for
// BOTH organizations. Then every way to demote or deactivate the Owner is tried, each must be refused.
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { createOrganization, createWarehouse, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(120000);

const PASSWORD = "Gula-Kopi-2026";
let orgs;
let owners;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const as = (user) => `Bearer ${signToken(user.id)}`;

// The rule, read straight from the table: per organization, one row with role OWNER, and it is active.
async function expectOneActiveOwnerEach() {
  const rows = await sql(
    `SELECT "organizationId", count(*) FILTER (WHERE "role" = 'OWNER') AS owners,
            count(*) FILTER (WHERE "role" = 'OWNER' AND "isActive") AS active_owners
       FROM "Users" WHERE "organizationId" IS NOT NULL GROUP BY "organizationId"`,
  );
  expect(rows).toHaveLength(2);
  for (const row of rows) expect([Number(row.owners), Number(row.active_owners)]).toEqual([1, 1]);
}

const invite = (owner, email, role = "VIEWER", warehouseIds = []) =>
  request(app).post("/api/invitations").set("Authorization", as(owner)).send({ email, role, warehouseIds });
const accept = (token) => request(app).post("/api/auth/accept-invite").send({ token, name: "Anggota Baru", password: PASSWORD });
const patch = (owner, id, body) => request(app).patch(`/api/members/${id}`).set("Authorization", as(owner)).send(body);
const resetLink = (owner, id) => request(app).post(`/api/members/${id}/reset-link`).set("Authorization", as(owner));
const reset = (token) => request(app).post("/api/auth/reset-password").send({ token, password: "Kopi-Gula-2027" });

// Invite and accept in one go; returns the user row (a new user, or the reactivated one).
async function join(owner, email, role = "VIEWER") {
  const created = await invite(owner, email, role);
  expect(created.status).toBe(201);
  const accepted = await accept(created.body.token);
  expect(accepted.status).toBe(200);
  return { id: accepted.body.user.id };
}

beforeEach(async () => {
  await clearTables(getSequelize());
  orgs = { A: await createOrganization("tokoa"), B: await createOrganization("tokob") };
  await giveRoomyPlan(orgs.A, orgs.B);
  owners = {
    A: await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgs.A }),
    B: await createAccount({ email: "owner-b@example.com", role: "OWNER", organizationId: orgs.B }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("exactly one active Owner per organization", () => {
  it("holds after every step of a fixed series (invite, accept, change role, deactivate, reset, invite again)", async () => {
    await expectOneActiveOwnerEach();
    const w1 = await createWarehouse(orgs.A, "GD-1");

    const sari = await join(owners.A, "sari@example.com", "WAREHOUSE_ADMIN");
    await expectOneActiveOwnerEach();
    const andi = await join(owners.A, "andi@example.com");
    await join(owners.B, "budi@example.com");
    await expectOneActiveOwnerEach();

    expect((await patch(owners.A, sari.id, { role: "VIEWER" })).status).toBe(200);
    expect((await patch(owners.A, sari.id, { role: "WAREHOUSE_ADMIN", warehouseIds: [w1] })).status).toBe(200);
    await expectOneActiveOwnerEach();

    const link = await resetLink(owners.A, andi.id);
    expect(link.status).toBe(201);
    expect((await reset(link.body.token)).status).toBe(204);
    await expectOneActiveOwnerEach();

    expect((await patch(owners.A, andi.id, { isActive: false })).status).toBe(200);
    await expectOneActiveOwnerEach();
    const again = await join(owners.A, "andi@example.com", "WAREHOUSE_ADMIN");
    expect(again.id).toBe(andi.id);
    expect((await readUser(andi.id)).isActive).toBe(true);
    await expectOneActiveOwnerEach();
  });

  it("holds after every operation of a long pseudo-random series, and the Owners are never touched", async () => {
    // A fixed seed: the same series every run, so a failure can be replayed.
    let seed = 20261110;
    const next = (n) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };
    const members = { A: [], B: [] };

    for (let step = 0; step < 40; step += 1) {
      const key = next(2) === 0 ? "A" : "B";
      const owner = owners[key];
      const pool = members[key];
      const target = pool.length ? pool[next(pool.length)] : null;
      const choice = next(6);

      if (choice === 0 || !target) {
        const email = `m${step}-${key.toLowerCase()}@example.com`;
        pool.push({ ...(await join(owner, email, next(2) === 0 ? "VIEWER" : "WAREHOUSE_ADMIN")), email });
      } else if (choice === 1) {
        await patch(owner, target.id, { role: next(2) === 0 ? "VIEWER" : "WAREHOUSE_ADMIN" });
      } else if (choice === 2) {
        await patch(owner, target.id, { isActive: false });
      } else if (choice === 3) {
        await resetLink(owner, target.id);
      } else if (choice === 4) {
        // Every attempt at the Owner, in the middle of the series.
        await patch(owner, owner.id, { role: "VIEWER" });
        await patch(owner, owner.id, { isActive: false });
        await patch(owner, target.id, { role: "OWNER" });
      } else {
        const created = await invite(owner, target.email);
        if (created.status === 201) await accept(created.body.token);
      }

      await expectOneActiveOwnerEach();
      for (const k of ["A", "B"]) expect(await readUser(owners[k].id)).toMatchObject({ role: "OWNER", isActive: true });
    }
  });
});

describe("no path demotes or deactivates the Owner", () => {
  it("is refused for the Owner themselves: role change, deactivation, reset link", async () => {
    for (const body of [{ role: "VIEWER" }, { role: "WAREHOUSE_ADMIN" }, { isActive: false }]) {
      expect((await patch(owners.A, owners.A.id, body)).status).toBe(409);
    }
    expect((await resetLink(owners.A, owners.A.id)).status).toBe(409);
    expect(await readUser(owners.A.id)).toMatchObject({ role: "OWNER", isActive: true });
  });

  it("is refused for another organization's Owner (404) and for any other role (403)", async () => {
    const viewer = await join(owners.A, "andi@example.com");
    const viewerAccount = { id: viewer.id };

    expect((await patch(owners.A, owners.B.id, { isActive: false })).status).toBe(404);
    expect((await patch(owners.B, owners.A.id, { role: "VIEWER" })).status).toBe(404);
    expect((await patch(viewerAccount, owners.A.id, { role: "VIEWER" })).status).toBe(403);
    expect((await patch(viewerAccount, owners.A.id, { isActive: false })).status).toBe(403);
    for (const key of ["A", "B"]) expect(await readUser(owners[key].id)).toMatchObject({ role: "OWNER", isActive: true });
  });

  it("no second Owner can be made: the role OWNER is refused on invite and on PATCH (400)", async () => {
    const viewer = await join(owners.A, "andi@example.com");

    expect((await invite(owners.A, "boss@example.com", "OWNER")).status).toBe(400);
    expect((await patch(owners.A, viewer.id, { role: "OWNER" })).status).toBe(400);
    await expectOneActiveOwnerEach();
  });
});
