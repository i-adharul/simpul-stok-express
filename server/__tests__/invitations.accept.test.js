const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const env = require("../config/env");
const db = require("../models");
const invitationAccess = require("../helpers/invitationAccess");
const { signToken } = require("../helpers/jwt");
const { logger } = require("../helpers/logger");
const { generateToken, hashToken } = require("../helpers/token");
const { COST } = require("../helpers/bcrypt");
const { bcryptPrefix } = require("./support/bcryptPrefix");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { runConcurrently } = require("./support/concurrency");
const { createOrganization, createWarehouse, assignWarehouse, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(60000);

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "Gula-Kopi-2026";
const NOT_FOUND = { code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null };
let orgA;
let orgB;
let owner;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const ownerAuth = () => `Bearer ${signToken(owner.id)}`;

// Creates an invitation through the real endpoint and returns the raw token, like the Owner's screen would.
async function invite(body) {
  const res = await request(app).post("/api/invitations").set("Authorization", ownerAuth()).send(body);
  expect(res.status).toBe(201);
  return { token: res.body.token, id: res.body.invitation.id };
}
const accept = (body) => request(app).post("/api/auth/accept-invite").send({ name: "Sari Gudang", password: PASSWORD, ...body });
const peek = (token) => request(app).get(`/api/invitations/${token}`);
const invitationRow = async (id) => (await sql('SELECT * FROM "Invitations" WHERE "id" = :id', { id }))[0];
const usersByEmail = (email) => sql('SELECT * FROM "Users" WHERE "email" = :email', { email });
const assignments = (userId) => sql('SELECT "warehouseId" FROM "UserWarehouses" WHERE "userId" = :userId', { userId });

// An invitation written directly with a known raw token, to reach states the API cannot (expired).
async function seed({ token = generateToken(), email = "sari@example.com", createdDaysAgo = 0, expiresInDays = 7, acceptedAt = null }) {
  const createdAt = new Date(Date.now() - createdDaysAgo * DAY);
  await sql(
    `INSERT INTO "Invitations" ("organizationId","email","role","tokenHash","expiresAt","acceptedAt","createdById","createdAt")
     VALUES (:orgA,:email,'VIEWER',:hash,:expiresAt,:acceptedAt,:createdById,:createdAt)`,
    { orgA, email, hash: hashToken(token), expiresAt: new Date(createdAt.getTime() + expiresInDays * DAY), acceptedAt, createdById: owner.id, createdAt },
  );
  return token;
}

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  await giveRoomyPlan(orgA, orgB);
  owner = await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgA });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("GET /api/invitations/:token", () => {
  it("shows email, role, organization name and expiry for a usable token, never cached", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "WAREHOUSE_ADMIN" });

    const res = await peek(token);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      email: "sari@example.com",
      role: "WAREHOUSE_ADMIN",
      organizationName: "Toko",
      expiresAt: expect.any(String),
    });
  });

  it("answers a malformed, unknown, expired, used and cancelled token with one identical 404", async () => {
    const expired = await seed({ email: "old@example.com", createdDaysAgo: 10 });
    const used = await seed({ email: "used@example.com", acceptedAt: new Date() });
    const cancelled = await invite({ email: "gone@example.com", role: "VIEWER" });
    await request(app).delete(`/api/invitations/${cancelled.id}`).set("Authorization", ownerAuth());

    const answers = await Promise.all(
      ["x", "a".repeat(43), generateToken(), expired, used, cancelled.token, "%00%00"].map((token) => peek(token)),
    );

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });
});

describe("POST /api/auth/accept-invite: success", () => {
  it("creates the user and the assignments, marks the invitation used and logs the person in", async () => {
    const w1 = await createWarehouse(orgA, "GD-1");
    const w2 = await createWarehouse(orgA, "GD-2");
    const archived = await createWarehouse(orgA, "GD-3");
    const { token, id } = await invite({ email: "Sari@Example.com", role: "WAREHOUSE_ADMIN", warehouseIds: [w1, w2, archived] });
    await sql('UPDATE "Warehouses" SET "archivedAt" = now() WHERE "id" = :archived', { archived });

    const res = await accept({ token, name: "  Sari Gudang " });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: expect.any(String), name: "Sari Gudang", email: "sari@example.com", role: "WAREHOUSE_ADMIN" },
      redirectTo: "/dashboard",
    });
    const [user] = await usersByEmail("sari@example.com");
    expect(user).toMatchObject({ organizationId: orgA, role: "WAREHOUSE_ADMIN", isActive: true });
    expect(user.passwordHash).toMatch(bcryptPrefix(COST));
    expect((await assignments(user.id)).map((r) => r.warehouseId).sort()).toEqual([w1, w2].sort());
    expect((await invitationRow(id)).acceptedAt).not.toBeNull();
    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${res.body.token}`);
    expect(me.body.user).toMatchObject({ id: user.id, role: "WAREHOUSE_ADMIN" });
    const login = await request(app).post("/api/auth/login").send({ email: "sari@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("gives the member the organization of the INVITATION, whatever else the body says", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });

    const res = await accept({ token, organizationId: orgB });

    expect(res.status).toBe(400);
    expect(await usersByEmail("sari@example.com")).toHaveLength(0);
  });
});

describe("POST /api/auth/accept-invite: tokens that cannot be used", () => {
  it("expired, used, unknown and malformed tokens give 404, even with a weak password", async () => {
    const expired = await seed({ email: "old@example.com", createdDaysAgo: 10 });
    const used = await seed({ email: "used@example.com", acceptedAt: new Date() });

    for (const token of [expired, used, generateToken(), "x"]) {
      const res = await accept({ token, password: "short" });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    expect(await usersByEmail("old@example.com")).toHaveLength(0);
  });

  it("a token cannot be used a second time", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });

    expect((await accept({ token })).status).toBe(200);
    const again = await accept({ token, name: "Orang Lain", password: "Lain-Lagi-2027" });

    expect(again.status).toBe(404);
    expect((await usersByEmail("sari@example.com"))[0].name).toBe("Sari Gudang");
  });
});

describe("POST /api/auth/accept-invite: password and body", () => {
  it.each([
    ["too short", "abc1"],
    ["no digit", "hanyahuruf"],
    ["a common password", "password123"],
    ["the invited email", "sari@example.com"],
    ["the part before the @", "sari-gudang1"],
  ])("400 for a password that is %s, and the invitation stays usable", async (_label, password) => {
    const { token, id } = await invite({ email: password === "sari-gudang1" ? "sari-gudang1@example.com" : "sari@example.com", role: "VIEWER" });

    const res = await accept({ token, password });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([expect.objectContaining({ source: "body", path: "password" })]);
    expect((await invitationRow(id)).acceptedAt).toBeNull();
  });

  it("400 for a missing field or an unknown key", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });

    expect((await request(app).post("/api/auth/accept-invite").send({ token })).status).toBe(400);
    expect((await accept({ token, role: "OWNER" })).status).toBe(400);
    expect((await accept({ token, email: "x@example.com" })).status).toBe(400);
  });
});

describe("POST /api/auth/accept-invite: the email already exists", () => {
  it("409 for an email that now belongs to an active user, and the invitation is not used", async () => {
    const { token, id } = await invite({ email: "sari@example.com", role: "VIEWER" });
    await createAccount({ email: "sari@example.com", role: "VIEWER", organizationId: orgB });

    const res = await accept({ token });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect((await invitationRow(id)).acceptedAt).toBeNull();
    expect(await usersByEmail("sari@example.com")).toHaveLength(1);
  });

  it("409 for an email that now belongs to an active user of the same organization", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });
    await createAccount({ email: "sari@example.com", role: "VIEWER", organizationId: orgA });

    expect((await accept({ token })).status).toBe(409);
  });

  it("409 for an inactive user of ANOTHER organization", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });
    await createAccount({ email: "sari@example.com", role: "VIEWER", organizationId: orgB, isActive: false });

    expect((await accept({ token })).status).toBe(409);
  });
});

describe("POST /api/auth/accept-invite: an inactive member comes back", () => {
  it("reactivates the user with the new name, password, role and assignment; the old token stops working", async () => {
    const old = await createAccount({ email: "sari@example.com", name: "Nama Lama", password: "Password-Lama-9", role: "VIEWER", organizationId: orgA, isActive: false });
    const w1 = await createWarehouse(orgA, "GD-1");
    const w2 = await createWarehouse(orgA, "GD-2");
    await assignWarehouse(orgA, old.id, w1);
    // A token issued 100 seconds ago, while the user was still active.
    const oldToken = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 100 }, env.JWT_SECRET, {
      algorithm: "HS256",
      subject: old.id,
      expiresIn: "8h",
    });
    const { token } = await invite({ email: "sari@example.com", role: "WAREHOUSE_ADMIN", warehouseIds: [w2] });

    const res = await accept({ token, name: "Nama Baru" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: old.id, name: "Nama Baru", email: "sari@example.com", role: "WAREHOUSE_ADMIN" });
    expect(await usersByEmail("sari@example.com")).toHaveLength(1);
    const user = await readUser(old.id);
    expect(user).toMatchObject({ isActive: true, role: "WAREHOUSE_ADMIN", name: "Nama Baru" });
    expect(user.passwordChangedAt).not.toBeNull();
    expect((await assignments(old.id)).map((r) => r.warehouseId)).toEqual([w2]);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${oldToken}`)).status).toBe(401);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${res.body.token}`)).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: "sari@example.com", password: "Password-Lama-9" })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "sari@example.com", password: PASSWORD })).status).toBe(200);
  });
});

describe("POST /api/auth/accept-invite: one transaction", () => {
  afterEach(() => jest.restoreAllMocks());

  it("leaves no user, no assignment and no acceptedAt when the last write fails", async () => {
    const w1 = await createWarehouse(orgA, "GD-1");
    const { token, id } = await invite({ email: "sari@example.com", role: "VIEWER", warehouseIds: [w1] });
    jest.spyOn(invitationAccess, "markAccepted").mockRejectedValue(new Error("boom"));

    const res = await accept({ token });

    expect(res.status).toBe(500);
    expect(await usersByEmail("sari@example.com")).toHaveLength(0);
    expect(await sql('SELECT * FROM "UserWarehouses"')).toHaveLength(0);
    expect((await invitationRow(id)).acceptedAt).toBeNull();

    jest.restoreAllMocks();
    expect((await accept({ token })).status).toBe(200);
  });
});

describe("POST /api/auth/accept-invite: simultaneous acceptances", () => {
  it("of one token: exactly one 200 and the rest 404, and one user", async () => {
    const { token } = await invite({ email: "sari@example.com", role: "VIEWER" });

    const results = await runConcurrently(8, () => accept({ token }));

    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 404, 404, 404, 404, 404, 404, 404]);
    expect(await usersByEmail("sari@example.com")).toHaveLength(1);
  });

  it("of the same email from two organizations: one 200 and one 409", async () => {
    const { token: a } = await invite({ email: "sari@example.com", role: "VIEWER" });
    const ownerB = await createAccount({ email: "owner-b@example.com", role: "OWNER", organizationId: orgB });
    const tokenB = generateToken();
    await sql(
      `INSERT INTO "Invitations" ("organizationId","email","role","tokenHash","expiresAt","createdById")
       VALUES (:orgB,'sari@example.com','VIEWER',:hash, now() + interval '7 days', :createdById)`,
      { orgB, hash: hashToken(tokenB), createdById: ownerB.id },
    );

    const results = await Promise.all([accept({ token: a }), accept({ token: tokenB })]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await usersByEmail("sari@example.com")).toHaveLength(1);
  });
});

describe("POST /api/auth/accept-invite: logs", () => {
  afterEach(() => jest.restoreAllMocks());

  it("never contain the raw token, the password or the email", async () => {
    const { token } = await invite({ email: "rahasia.sari@example.com", role: "VIEWER" });
    const lines = [];
    for (const level of ["info", "warn", "error"]) {
      jest.spyOn(logger, level).mockImplementation((message, fields) => lines.push(JSON.stringify({ message, ...fields })));
    }

    const ok = await accept({ token, password: "Sangat-Rahasia-77" });
    await peek(token);
    await accept({ token, password: "Sangat-Rahasia-77" });
    await peek("x".repeat(43));
    const logs = lines.join("\n");

    expect(logs).toMatch(/\/api\/invitations\/:token/);
    expect(logs).toMatch(/\/api\/auth\/accept-invite/);
    for (const secret of [token, "Sangat-Rahasia-77", "rahasia.sari", ok.body.token]) expect(logs).not.toContain(secret);
  });
});
