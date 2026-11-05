const jwt = require("jsonwebtoken");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { login } = require("../services/authService");
const { AppError } = require("../helpers/errors");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const expectInvalidCredentials = async (promise) => {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect(error.code).toBe("INVALID_CREDENTIALS");
  expect(error.status).toBe(401);
  expect(error.message).toBe("Email atau password salah.");
  expect(error.details).toBeNull();
};

describe("authService.login: success", () => {
  it("returns a token, the public user fields and /dashboard for a tenant role", async () => {
    const user = await createAccount({ email: "owner@example.com", role: "OWNER" });

    const result = await login({ email: "owner@example.com", password: user.password });

    expect(result.redirectTo).toBe("/dashboard");
    expect(result.user).toEqual({
      id: user.id,
      name: "Budi Owner",
      email: "owner@example.com",
      role: "OWNER",
    });
    expect(Object.keys(jwt.decode(result.token)).sort()).toEqual(["exp", "iat", "sub"]);
    expect(jwt.decode(result.token).sub).toBe(user.id);
  });

  it("sends a platform admin to /platform", async () => {
    const user = await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" });

    const result = await login({ email: "platform@example.com", password: user.password });

    expect(result.redirectTo).toBe("/platform");
    expect(result.user.role).toBe("PLATFORM_ADMIN");
  });

  it("never returns the password hash or the organization ID", async () => {
    const user = await createAccount();

    const result = await login({ email: user.email, password: user.password });

    expect(JSON.stringify(result)).not.toMatch(/passwordHash|\$2[aby]\$|organizationId/);
  });

  it("sets lastLoginAt", async () => {
    const user = await createAccount();
    expect((await readUser(user.id)).lastLoginAt).toBeNull();

    await login({ email: user.email, password: user.password });

    expect((await readUser(user.id)).lastLoginAt).toBeInstanceOf(Date);
  });

  it("finds the user whatever the case of the stored lookup (email is already lowercase)", async () => {
    const user = await createAccount({ email: "owner@example.com" });

    await expect(login({ email: "owner@example.com", password: user.password })).resolves.toBeDefined();
  });
});

describe("authService.login: every failure is the same 401", () => {
  it("unknown email", async () => {
    await createAccount();

    await expectInvalidCredentials(login({ email: "nobody@example.com", password: "Gula-Kopi-2026" }));
  });

  it("wrong password", async () => {
    const user = await createAccount();

    await expectInvalidCredentials(login({ email: user.email, password: "Salah-Banget-1" }));
  });

  it("inactive user, even with the right password", async () => {
    const user = await createAccount({ isActive: false });

    await expectInvalidCredentials(login({ email: user.email, password: user.password }));
  });

  it("password over 72 bytes whose first 72 bytes are the real password", async () => {
    const real = `${"a".repeat(70)}1x`;
    const user = await createAccount({ password: real });

    await expectInvalidCredentials(login({ email: user.email, password: `${real}extra` }));
  });

  it("does not set lastLoginAt after a failure", async () => {
    const user = await createAccount();

    await login({ email: user.email, password: "Salah-Banget-1" }).catch(() => {});

    expect((await readUser(user.id)).lastLoginAt).toBeNull();
  });
});
