// Gaps found by the BL05 to BL07 audit (docs/06_Test_Plan.md, "Member and invitation rules"):
// a reset link that expired or belongs to a deactivated member is refused on POST too (only GET was
// proven), and the invitation row lock is proven on its own, apart from the organization lock.
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(60000);

const NOT_FOUND = { code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null };
const NEW_PASSWORD = "Kopi-Gula-2027";
let orgA;
let owner;
let viewer;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const ownerAuth = () => `Bearer ${signToken(owner.id)}`;
const resetLink = async () => (await request(app).post(`/api/members/${viewer.id}/reset-link`).set("Authorization", ownerAuth())).body.token;
const reset = (token) => request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD });
const login = (password) => request(app).post("/api/auth/login").send({ email: "viewer-a@example.com", password });

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  await giveRoomyPlan(orgA);
  owner = await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgA });
  viewer = await createAccount({ email: "viewer-a@example.com", role: "VIEWER", organizationId: orgA });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("POST /api/auth/reset-password: a link that can no longer be used", () => {
  it("an expired link is the identical 404, and the password does not change", async () => {
    const token = await resetLink();
    await sql(`UPDATE "Users" SET "resetExpiresAt" = now() - interval '1 second' WHERE "id" = :id`, { id: viewer.id });

    const res = await reset(token);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await login(viewer.password)).status).toBe(200);
    expect((await login(NEW_PASSWORD)).status).toBe(401);
  });

  it("the link of a member deactivated afterwards is the identical 404, and the member stays inactive", async () => {
    const token = await resetLink();
    await sql('UPDATE "Users" SET "isActive" = false WHERE "id" = :id', { id: viewer.id });

    const res = await reset(token);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect((await sql('SELECT "isActive" FROM "Users" WHERE "id" = :id', { id: viewer.id }))[0].isActive).toBe(false);
    expect((await login(NEW_PASSWORD)).status).toBe(401);
  });
});

// The organization lock already serializes two acceptances. The invitation row lock is what stops a
// cancel and an acceptance from both winning (the cancel does not take the organization lock), so it is
// proven here by holding that row alone, with the organization row free.
describe("POST /api/auth/accept-invite: the invitation row lock", () => {
  it("an acceptance waits for a transaction that holds the invitation row, then sees it gone (404)", async () => {
    const created = await request(app)
      .post("/api/invitations")
      .set("Authorization", ownerAuth())
      .send({ email: "sari@example.com", role: "VIEWER", warehouseIds: [] });
    expect(created.status).toBe(201);
    const { token } = created.body;
    const id = created.body.invitation.id;

    const sequelize = getSequelize();
    const holder = await sequelize.transaction();
    let settled = false;
    try {
      await sequelize.query('SELECT "id" FROM "Invitations" WHERE "id" = :id FOR UPDATE', { replacements: { id }, transaction: holder });

      const pending = request(app)
        .post("/api/auth/accept-invite")
        .send({ token, name: "Sari Gudang", password: "Gula-Kopi-2026" })
        .then((res) => {
          settled = true;
          return res;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);

      await sequelize.query('DELETE FROM "Invitations" WHERE "id" = :id', { replacements: { id }, transaction: holder });
      await holder.commit();

      const res = await pending;
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
      expect(await sql('SELECT 1 FROM "Users" WHERE "email" = :email', { email: "sari@example.com" })).toHaveLength(0);
    } finally {
      if (!holder.finished) await holder.rollback();
    }
  });
});
