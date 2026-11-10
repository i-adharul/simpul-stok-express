// E7 role matrix: the organization endpoints (they have no ID, so they are exempt from the registry) and
// every endpoint added in E7 that is addressed by a role: Owner only, Warehouse Admin, Viewer and
// Platform admin get 403 (also for a foreign ID), no token and a damaged token get 401.
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { roleAllows } = require("../helpers/permissions");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, labelOf } = require("./support/registry");
const { checkRoleMatrix, checkViewerWrites } = require("./support/roleMatrix");
const { checkNoToken, checkPlatformAdmin, checkRoleWithoutRight } = require("./support/harness");

jest.setTimeout(120000);

let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const authOf = (who) => (who === "PLATFORM_ADMIN" ? world.platformAdmin.authorization : world.users.A[who].authorization);

// Written out by hand (not read from the matrix), so a wrong edit of the matrix cannot pass here.
const EXPECTED = {
  read: { OWNER: 200, WAREHOUSE_ADMIN: 200, VIEWER: 200, PLATFORM_ADMIN: 403 },
  manage: { OWNER: 200, WAREHOUSE_ADMIN: 403, VIEWER: 403, PLATFORM_ADMIN: 403 },
};

describe("GET /api/organization (organization.read)", () => {
  it.each(Object.entries(EXPECTED.read))("%s gets %i", async (who, status) => {
    expect((await request(app).get("/api/organization").set("Authorization", authOf(who))).status).toBe(status);
  });

  it("no token and a garbage token get 401", async () => {
    expect((await request(app).get("/api/organization")).status).toBe(401);
    expect((await request(app).get("/api/organization").set("Authorization", "Bearer not.a.token")).status).toBe(401);
  });

  it("agrees with the permission table", () => {
    for (const [who, status] of Object.entries(EXPECTED.read)) expect(roleAllows(who, "organization.read")).toBe(status === 200);
  });
});

describe("PATCH /api/organization (organization.manage)", () => {
  it.each(Object.entries(EXPECTED.manage))("%s gets %i", async (who, status) => {
    const res = await request(app).patch("/api/organization").set("Authorization", authOf(who)).send({ name: "Nama Baru" });

    expect(res.status).toBe(status);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER", "PLATFORM_ADMIN"])("%s gets 403 even for an invalid body (the role is checked first)", async (who) => {
    const res = await request(app).patch("/api/organization").set("Authorization", authOf(who)).send({ organizationId: "x", unknown: 1 });

    expect(res.status).toBe(403);
  });

  it("no token and a garbage token get 401", async () => {
    expect((await request(app).patch("/api/organization").send({ name: "X" })).status).toBe(401);
    expect((await request(app).patch("/api/organization").set("Authorization", "Bearer not.a.token").send({ name: "X" })).status).toBe(401);
  });

  it("agrees with the permission table", () => {
    for (const [who, status] of Object.entries(EXPECTED.manage)) expect(roleAllows(who, "organization.manage")).toBe(status === 200);
  });
});

// The endpoints E7 added to the registry. Listed by hand: removing one from the registry fails here.
const E7_LABELS = [
  "GET /members",
  "PATCH /members/:id",
  "POST /members/:id/reset-link",
  "GET /invitations",
  "POST /invitations",
  "DELETE /invitations/:id",
];

describe("every E7 endpoint with a role (member.manage: the Owner only)", () => {
  it("is in the registry", () => {
    const labels = TENANT_ENDPOINTS.map(labelOf);

    for (const label of E7_LABELS) expect(labels).toContain(label);
  });

  for (const label of E7_LABELS) {
    const entry = () => TENANT_ENDPOINTS.find((candidate) => labelOf(candidate) === label);

    it(`${label}: Owner only, the others 403, no token 401`, async () => {
      expect(entry().action).toBe("member.manage");
      expect(await checkRoleMatrix(app, entry(), world)).toEqual([]);
      expect(await checkRoleWithoutRight(app, entry(), world)).toEqual([]);
      expect(await checkPlatformAdmin(app, entry(), world)).toEqual([]);
      expect(await checkNoToken(app, entry(), world)).toEqual([]);
    });

    it(`${label}: a Viewer cannot write`, async () => {
      expect(await checkViewerWrites(app, entry(), world)).toEqual([]);
    });
  }
});
