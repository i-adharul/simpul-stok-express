const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const env = require("../config/env");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const NEW = "Kopi-Susu-2027";
const PATH = "/api/me/password";

const change = (token, body) => {
  const req = request(app).patch(PATH);
  return (token ? req.set("Authorization", `Bearer ${token}`) : req).send(body);
};
const me = (token) => request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("PATCH /api/me/password: success", () => {
  it("answers 200 with a new token, never cached", async () => {
    const user = await createAccount();

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(res.body)).toEqual(["token"]);
    expect(jwt.decode(res.body.token).sub).toBe(user.id);
  });

  it("the new token works", async () => {
    const user = await createAccount();

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

    expect((await me(res.body.token)).status).toBe(200);
  });

  it("the old token is rejected afterwards, like a token on another device", async () => {
    const user = await createAccount();
    // Issued 60 seconds ago, as if from another device: older than the change by whole seconds.
    const otherDevice = jwt.sign({ iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      subject: user.id,
      expiresIn: "8h",
    });
    expect((await me(otherDevice)).status).toBe(200);

    await change(otherDevice, { currentPassword: user.password, newPassword: NEW });

    const res = await me(otherDevice);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("the new password logs in and the old one does not", async () => {
    const user = await createAccount();
    await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

    expect((await login(user.email, NEW)).status).toBe(200);
    expect((await login(user.email, user.password)).status).toBe(401);
  });

  it("works for a platform admin and for every tenant role", async () => {
    for (const role of ["PLATFORM_ADMIN", "OWNER", "WAREHOUSE_ADMIN", "VIEWER"]) {
      await clearTables(getSequelize());
      const user = await createAccount({ role });

      const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

      expect(res.status).toBe(200);
    }
  });

  it("works when the organization is suspended (every subscription state)", async () => {
    const user = await createAccount();
    await getSequelize().query(`UPDATE "Organizations" SET "status" = 'SUSPENDED'`);

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/me/password: the current password", () => {
  it("a wrong one is 400 INVALID_CURRENT_PASSWORD and changes nothing", async () => {
    const user = await createAccount();
    const before = await readUser(user.id);

    const res = await change(signToken(user.id), { currentPassword: "Salah-Banget-1", newPassword: NEW });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "INVALID_CURRENT_PASSWORD",
      message: "Password saat ini salah.",
      details: null,
    });
    const after = await readUser(user.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordChangedAt).toBeNull();
  });

  it("is checked before the rules: a weak new password with a wrong current one is INVALID_CURRENT_PASSWORD", async () => {
    const user = await createAccount();

    const res = await change(signToken(user.id), { currentPassword: "Salah-Banget-1", newPassword: "123" });

    expect(res.body.code).toBe("INVALID_CURRENT_PASSWORD");
  });
});

describe("PATCH /api/me/password: a refused new password", () => {
  it.each([
    ["too short", "abc1", "Password harus minimal 8 karakter dan mengandung huruf serta angka."],
    ["letters only", "abcdefghij", "Password harus minimal 8 karakter dan mengandung huruf serta angka."],
    ["common", "Password123", "Password terlalu umum."],
    ["over 72 bytes", `${"a".repeat(72)}1`, "Password maksimal 72 karakter."],
  ])("%s is 400 VALIDATION_ERROR with the reason", async (_name, newPassword, message) => {
    const user = await createAccount();

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "VALIDATION_ERROR",
      message,
      details: [{ source: "body", path: "newPassword", message }],
    });
    expect((await readUser(user.id)).passwordChangedAt).toBeNull();
  });

  it("the email of the user is refused", async () => {
    const user = await createAccount({ email: "budi12345@example.com" });

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: "BUDI12345" });

    expect(res.body.message).toBe("Password tidak boleh sama dengan email.");
  });
});

describe("PATCH /api/me/password: bad input", () => {
  it.each([
    ["no body", undefined],
    ["missing newPassword", { currentPassword: "x" }],
    ["missing currentPassword", { newPassword: NEW }],
    ["empty currentPassword", { currentPassword: "", newPassword: NEW }],
    ["currentPassword over 128", { currentPassword: "p".repeat(129), newPassword: NEW }],
    ["newPassword over 128", { currentPassword: "x", newPassword: "p".repeat(129) }],
    ["not strings", { currentPassword: 1, newPassword: ["x"] }],
    ["unknown field (userId)", { currentPassword: "x", newPassword: NEW, userId: "other" }],
  ])("%s is 400 VALIDATION_ERROR", async (_name, body) => {
    const user = await createAccount();

    const res = await change(signToken(user.id), body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("a body that is not JSON is 400 VALIDATION_ERROR", async () => {
    const user = await createAccount();

    const res = await request(app)
      .patch(PATH)
      .set("Authorization", `Bearer ${signToken(user.id)}`)
      .set("Content-Type", "application/json")
      .send("{oops");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/me/password: no session", () => {
  const UNAUTHENTICATED = {
    code: "UNAUTHENTICATED",
    message: "Sesi tidak valid. Silakan masuk lagi.",
    details: null,
  };

  it("no token is 401, even with a body that would also be invalid", async () => {
    const res = await change(undefined, {});

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHENTICATED);
  });

  it("an expired token is 401", async () => {
    const user = await createAccount();

    const res = await change(signToken(user.id, "-1s"), { currentPassword: user.password, newPassword: NEW });

    expect(res.status).toBe(401);
    expect(res.body).toEqual(UNAUTHENTICATED);
  });

  it("an inactive user is 401 and the password stays", async () => {
    const user = await createAccount({ isActive: false });
    const before = await readUser(user.id);

    const res = await change(signToken(user.id), { currentPassword: user.password, newPassword: NEW });

    expect(res.status).toBe(401);
    expect((await readUser(user.id)).passwordHash).toBe(before.passwordHash);
  });

  it("the user is the one in the token: a userId in the body is refused, not used", async () => {
    const owner = await createAccount({ email: "owner@example.com" });
    const victim = await createAccount({
      email: "victim@example.com",
      organizationId: owner.organizationId,
      role: "VIEWER",
    });
    const before = await readUser(victim.id);

    const res = await change(signToken(owner.id), {
      currentPassword: owner.password,
      newPassword: NEW,
      userId: victim.id,
    });

    expect(res.status).toBe(400);
    expect((await readUser(victim.id)).passwordHash).toBe(before.passwordHash);
  });
});
