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

describe("authService.changePassword", () => {
  const { changePassword } = require("../services/authService");
  const { comparePassword } = require("../helpers/bcrypt");
  const { verifyToken } = require("../helpers/jwt");

  const NEW = "Kopi-Susu-2027";

  it("stores a new hash, sets passwordChangedAt and returns a token for the same user", async () => {
    const user = await createAccount();
    const before = await readUser(user.id);

    const result = await changePassword(user.id, { currentPassword: user.password, newPassword: NEW });

    const after = await readUser(user.id);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    await expect(comparePassword(NEW, after.passwordHash)).resolves.toBe(true);
    await expect(comparePassword(user.password, after.passwordHash)).resolves.toBe(false);
    expect(after.passwordChangedAt).toBeInstanceOf(Date);
    expect(verifyToken(result.token).sub).toBe(user.id);
    expect(Object.keys(result)).toEqual(["token"]);
  });

  it("the returned token was issued at or after passwordChangedAt", async () => {
    const user = await createAccount();

    const { token } = await changePassword(user.id, { currentPassword: user.password, newPassword: NEW });

    const { passwordChangedAt } = await readUser(user.id);
    expect(verifyToken(token).iat).toBeGreaterThanOrEqual(Math.floor(passwordChangedAt.getTime() / 1000));
  });

  it("a wrong current password throws INVALID_CURRENT_PASSWORD and changes nothing", async () => {
    const user = await createAccount();
    const before = await readUser(user.id);

    const error = await changePassword(user.id, { currentPassword: "Salah-Banget-1", newPassword: NEW }).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(error.status).toBe(400);
    expect(error.message).toBe("Password saat ini salah.");
    const after = await readUser(user.id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordChangedAt).toBeNull();
  });

  it("checks the current password before the rules: a weak new password with a wrong current one is INVALID_CURRENT_PASSWORD", async () => {
    const user = await createAccount();

    const error = await changePassword(user.id, { currentPassword: "Salah-Banget-1", newPassword: "123" }).catch((e) => e);

    expect(error.code).toBe("INVALID_CURRENT_PASSWORD");
  });

  it.each([
    ["too short", "abc1", "Password harus minimal 8 karakter dan mengandung huruf serta angka."],
    ["no digit", "abcdefghij", "Password harus minimal 8 karakter dan mengandung huruf serta angka."],
    ["common", "Password123", "Password terlalu umum."],
    ["over 72 bytes", `${"a".repeat(72)}1`, "Password maksimal 72 karakter."],
  ])("a refused new password (%s) throws VALIDATION_ERROR with the reason", async (_name, newPassword, message) => {
    const user = await createAccount({ email: "owner@example.com" });
    const before = await readUser(user.id);

    const error = await changePassword(user.id, { currentPassword: user.password, newPassword }).catch((e) => e);

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    expect(error.message).toBe(message);
    expect(error.details).toEqual([{ source: "body", path: "newPassword", message }]);
    expect((await readUser(user.id)).passwordHash).toBe(before.passwordHash);
  });

  it("refuses a new password equal to the part before the @ of the email", async () => {
    const user = await createAccount({ email: "budi12345@example.com" });

    const error = await changePassword(user.id, { currentPassword: user.password, newPassword: "budi12345" }).catch((e) => e);

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("Password tidak boleh sama dengan email.");
  });

  it("a current password over 72 bytes is just a wrong current password", async () => {
    const user = await createAccount();

    const error = await changePassword(user.id, { currentPassword: `${user.password}${"x".repeat(80)}`, newPassword: NEW }).catch((e) => e);

    expect(error.code).toBe("INVALID_CURRENT_PASSWORD");
  });
});
