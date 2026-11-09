const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { hashToken } = require("../helpers/token");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization } = require("./support/factories");

jest.setTimeout(60000);

const DAY = 24 * 60 * 60 * 1000;
let orgA;
let orgB;
let users;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const auth = (key = "OWNER") => `Bearer ${signToken(users[key].id)}`;
const createLink = (id, key = "OWNER") => request(app).post(`/api/members/${id}/reset-link`).set("Authorization", auth(key));
const resetColumns = async (id) => (await sql('SELECT "resetTokenHash", "resetExpiresAt" FROM "Users" WHERE "id" = :id', { id }))[0];

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  users = {
    OWNER: await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgA }),
    ADMIN: await createAccount({ email: "admin-a@example.com", role: "WAREHOUSE_ADMIN", organizationId: orgA }),
    VIEWER: await createAccount({ email: "viewer-a@example.com", role: "VIEWER", organizationId: orgA }),
    INACTIVE: await createAccount({ email: "gone-a@example.com", role: "VIEWER", isActive: false, organizationId: orgA }),
    PLATFORM_ADMIN: await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" }),
    OWNER_B: await createAccount({ email: "owner-b@example.com", role: "OWNER", organizationId: orgB }),
    VIEWER_B: await createAccount({ email: "viewer-b@example.com", role: "VIEWER", organizationId: orgB }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("POST /api/members/:id/reset-link", () => {
  it("creates a link for an active member: 201 { token, expiresAt }, only the hash is stored, valid 1 day", async () => {
    const before = Date.now();
    const res = await createLink(users.VIEWER.id);

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(["expiresAt", "token"]);
    expect(res.headers["cache-control"]).toBe("no-store");
    const row = await resetColumns(users.VIEWER.id);
    expect(row.resetTokenHash).toBe(hashToken(res.body.token));
    expect(row.resetTokenHash).not.toContain(res.body.token);
    const expires = new Date(res.body.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + DAY - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + DAY + 1000);
    expect(new Date(row.resetExpiresAt).getTime()).toBe(expires);
  });

  it("works for a Warehouse Admin too", async () => {
    expect((await createLink(users.ADMIN.id)).status).toBe(201);
  });

  it("a second link overwrites the first: one hash, the new expiry", async () => {
    const first = await createLink(users.VIEWER.id);
    const second = await createLink(users.VIEWER.id);

    expect(second.body.token).not.toBe(first.body.token);
    expect((await resetColumns(users.VIEWER.id)).resetTokenHash).toBe(hashToken(second.body.token));
  });

  it("an inactive member is 409 and nothing is written", async () => {
    const res = await createLink(users.INACTIVE.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await resetColumns(users.INACTIVE.id)).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it("the Owner (the caller) is 409", async () => {
    const res = await createLink(users.OWNER.id);

    expect(res.status).toBe(409);
    expect(await resetColumns(users.OWNER.id)).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it.each([
    ["a member of another organization", () => users.VIEWER_B.id],
    ["the Owner of another organization", () => users.OWNER_B.id],
    ["a Platform admin", () => users.PLATFORM_ADMIN.id],
    ["a random UUID", () => "6f1f3c5e-2f5a-4b6e-9a43-0d8f1c2b7a11"],
    ["a malformed ID", () => "not-a-uuid"],
  ])("%s is 404 with the identical body", async (label, id) => {
    const res = await createLink(id());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null });
    expect(await resetColumns(users.VIEWER_B.id)).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it("only the Owner: another role is 403 (even for a foreign ID), no token is 401", async () => {
    expect((await createLink(users.VIEWER.id, "ADMIN")).status).toBe(403);
    expect((await createLink(users.VIEWER_B.id, "VIEWER")).status).toBe(403);
    expect((await request(app).post(`/api/members/${users.VIEWER.id}/reset-link`)).status).toBe(401);
    expect(await resetColumns(users.VIEWER.id)).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it("refuses a body with fields (unknown keys are rejected)", async () => {
    const res = await createLink(users.VIEWER.id).send({ organizationId: orgB });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
