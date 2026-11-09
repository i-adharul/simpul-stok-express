const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const env = require("../config/env");
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

const NOT_FOUND = { code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null };
const peek = (token) => request(app).get(`/api/auth/reset-password/${token}`);
const linkFor = async (key = "VIEWER") => (await createLink(users[key].id)).body.token;

describe("GET /api/auth/reset-password/:token", () => {
  it("is public and returns only the email, with no-store", async () => {
    const res = await peek(await linkFor());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "viewer-a@example.com" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("an old link stops working when a new one is made", async () => {
    const first = await linkFor();
    const second = await linkFor();

    expect((await peek(first)).status).toBe(404);
    expect((await peek(second)).status).toBe(200);
  });

  it("an expired link is 404", async () => {
    const token = await linkFor();
    await sql('UPDATE "Users" SET "resetExpiresAt" = now() - interval \'1 second\' WHERE "id" = :id', { id: users.VIEWER.id });

    expect((await peek(token)).status).toBe(404);
  });

  it("the link of a member deactivated afterwards is 404", async () => {
    const token = await linkFor();
    await sql('UPDATE "Users" SET "isActive" = false WHERE "id" = :id', { id: users.VIEWER.id });

    expect((await peek(token)).status).toBe(404);
  });

  it("every kind of invalid token gets the byte-identical 404", async () => {
    const used = await linkFor();
    await sql('UPDATE "Users" SET "resetExpiresAt" = now() - interval \'1 second\' WHERE "id" = :id', { id: users.VIEWER.id });
    const bodies = [];
    for (const token of [used, "A".repeat(43), "short", "x".repeat(300), "%20", "ünïcode"]) {
      const res = await peek(token);
      expect(res.status).toBe(404);
      bodies.push(res.text);
    }

    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual(NOT_FOUND);
  });
});

const NEW_PASSWORD = "Kopi-Gula-2027";
const reset = (token, password = NEW_PASSWORD) => request(app).post("/api/auth/reset-password").send({ token, password });
const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("POST /api/auth/reset-password", () => {
  it("204 without a body; the new password signs in, the old one does not, the reset columns are cleared", async () => {
    const res = await reset(await linkFor());

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect((await login("viewer-a@example.com", NEW_PASSWORD)).status).toBe(200);
    expect((await login("viewer-a@example.com", users.VIEWER.password)).status).toBe(401);
    expect(await resetColumns(users.VIEWER.id)).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it("a session token issued before the reset gets 401 afterwards", async () => {
    // Issued a minute ago: well before the reset (whole-second comparison, docs/04).
    const old = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      algorithm: "HS256",
      subject: users.VIEWER.id,
      expiresIn: "8h",
    });
    const token = await linkFor();
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${old}`)).status).toBe(200);

    await reset(token);

    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${old}`)).status).toBe(401);
  });

  it("the link is single-use: a second use is the identical 404", async () => {
    const token = await linkFor();
    expect((await reset(token)).status).toBe(204);

    const again = await reset(token, "Another-Pass-2028");

    expect(again.status).toBe(404);
    expect(again.body).toEqual(NOT_FOUND);
    expect((await login("viewer-a@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  it("a refused password is 400 with its reason and the link stays usable", async () => {
    const token = await linkFor();

    const res = await reset(token, "viewer-a@example.com");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([{ source: "body", path: "password", message: res.body.message }]);
    expect((await reset(token)).status).toBe(204);
  });

  it("an invalid token is 404 whatever the password is", async () => {
    const res = await reset("A".repeat(43), "short");

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it("refuses unknown keys and a missing field with 400", async () => {
    const token = await linkFor();

    expect((await request(app).post("/api/auth/reset-password").send({ token, password: NEW_PASSWORD, email: "x@y.id" })).status).toBe(400);
    expect((await request(app).post("/api/auth/reset-password").send({ token })).status).toBe(400);
  });
});
