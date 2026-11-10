// E7 tenant isolation, explicit: another organization's member or invitation ID, and another
// organization's warehouseIds, are answered like a random UUID; the lists hold nothing of another
// organization. The registry run (crossTenant.test.js) covers every entry; this file names the E7 ones, so
// dropping an entry or its foreignBodies fails here, and compares the answers ACROSS endpoints.
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { RANDOM_UUID, checkForeignItem, checkForeignBodies, checkList, checkOrganizationIdInput } = require("./support/harness");

jest.setTimeout(120000);

const NOT_FOUND = { code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null };
let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const entryOf = (label) => TENANT_ENDPOINTS.find((entry) => labelOf(entry) === label);
const owner = () => ({ Authorization: world.users.A.OWNER.authorization });
const memberOfB = () => world.users.B.VIEWER.id;

describe("an ID of another organization is the same 404 as a random UUID", () => {
  it.each(["PATCH /members/:id", "POST /members/:id/reset-link", "DELETE /invitations/:id"])("%s", async (label) => {
    expect(await checkForeignItem(app, entryOf(label), world)).toEqual([]);
  });

  it("gives one identical body on every E7 endpoint (members and invitations), for B's row and for a random ID", async () => {
    const invitationOfB = await entryOf("DELETE /invitations/:id").createRow(world, "B");
    const foreignWarehouse = await world.createWarehouse("B");
    const asks = [
      request(app).patch(`/api/members/${memberOfB()}`).set(owner()).send({ role: "VIEWER" }),
      request(app).patch(`/api/members/${RANDOM_UUID}`).set(owner()).send({ role: "VIEWER" }),
      request(app).post(`/api/members/${memberOfB()}/reset-link`).set(owner()),
      request(app).post(`/api/members/${RANDOM_UUID}/reset-link`).set(owner()),
      request(app).delete(`/api/invitations/${invitationOfB.id}`).set(owner()),
      request(app).delete(`/api/invitations/${RANDOM_UUID}`).set(owner()),
      request(app).patch(`/api/members/${world.users.A.VIEWER.id}`).set(owner()).send({ warehouseIds: [foreignWarehouse] }),
      request(app).patch(`/api/members/${world.users.A.VIEWER.id}`).set(owner()).send({ warehouseIds: [RANDOM_UUID] }),
      request(app).post("/api/invitations").set(owner()).send({ email: "x1@example.com", role: "VIEWER", warehouseIds: [foreignWarehouse] }),
      request(app).post("/api/invitations").set(owner()).send({ email: "x2@example.com", role: "VIEWER", warehouseIds: [RANDOM_UUID] }),
    ];

    for (const res of await Promise.all(asks)) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    // B's invitation is still there.
    expect(await entryOf("DELETE /invitations/:id").readRow(invitationOfB.id)).not.toBeNull();
  });
});

describe("foreign warehouseIds", () => {
  it.each(["PATCH /members/:id", "POST /invitations"])("%s declares the key and answers B's warehouse like a random UUID", async (label) => {
    const entry = entryOf(label);

    expect((entry.foreignBodies ?? []).map((foreign) => foreign.key)).toEqual(["warehouseIds"]);
    expect(await checkForeignBodies(app, entry, world)).toEqual([]);
  });
});

describe("the lists hold nothing of another organization", () => {
  it.each(["GET /members", "GET /invitations"])("%s", async (label) => {
    expect(await checkList(app, entryOf(label), world)).toEqual([]);
    expect(await checkOrganizationIdInput(app, entryOf(label), world)).toEqual([]);
  });

  it("shows A's own people and none of B's, by email too", async () => {
    await entryOf("GET /invitations").createRow(world, "B");

    const members = await request(app).get("/api/members").query({ pageSize: 100 }).set(owner());
    const invitations = await request(app).get("/api/invitations").query({ pageSize: 100 }).set(owner());

    for (const res of [members, invitations]) {
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/-b@example\.com/);
      expect(res.text).not.toContain(world.organizations.B);
    }
    expect(members.text).toContain(world.users.A.VIEWER.email);
  });
});
