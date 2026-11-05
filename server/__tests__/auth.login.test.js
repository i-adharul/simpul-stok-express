const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { logger } = require("../helpers/logger");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");

jest.setTimeout(30000);

const LOGIN = "/api/auth/login";
const INVALID = {
  code: "INVALID_CREDENTIALS",
  message: "Email atau password salah.",
  details: null,
};

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const post = (body) => request(app).post(LOGIN).send(body);

describe("POST /api/auth/login: success", () => {
  it("answers 200 with token, user and redirectTo, and is never cached", async () => {
    const user = await createAccount({ email: "owner@example.com", name: "Budi Owner" });

    const res = await post({ email: "owner@example.com", password: user.password });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: user.id, name: "Budi Owner", email: "owner@example.com", role: "OWNER" },
      redirectTo: "/dashboard",
    });
  });

  it("sends a platform admin to /platform", async () => {
    const user = await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" });

    const res = await post({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.redirectTo).toBe("/platform");
  });

  it("issues a JWT with only sub, iat and exp, valid for 8 hours", async () => {
    const user = await createAccount();

    const { body } = await post({ email: user.email, password: user.password });
    const payload = jwt.decode(body.token);

    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(user.id);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  it("matches the email in lowercase and ignores spaces around it", async () => {
    const user = await createAccount({ email: "owner@example.com" });

    const res = await post({ email: "  OWNER@Example.COM ", password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("owner@example.com");
  });

  it("does not trim the password", async () => {
    const user = await createAccount({ password: "Gula-Kopi-2026" });

    const res = await post({ email: user.email, password: " Gula-Kopi-2026" });

    expect(res.status).toBe(401);
  });

  it("updates lastLoginAt", async () => {
    const user = await createAccount();

    await post({ email: user.email, password: user.password });

    expect((await readUser(user.id)).lastLoginAt).toBeInstanceOf(Date);
  });

  it("never returns the password hash or the organization", async () => {
    const user = await createAccount();

    const res = await post({ email: user.email, password: user.password });

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$|organizationId/);
  });
});

describe("POST /api/auth/login: one identical 401", () => {
  const expectInvalid = (res) => {
    expect(res.status).toBe(401);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual(INVALID);
  };

  it("wrong password", async () => {
    const user = await createAccount();

    expectInvalid(await post({ email: user.email, password: "Salah-Banget-1" }));
  });

  it("unknown email", async () => {
    await createAccount();

    expectInvalid(await post({ email: "nobody@example.com", password: "Gula-Kopi-2026" }));
  });

  it("inactive user with the right password", async () => {
    const user = await createAccount({ isActive: false });

    expectInvalid(await post({ email: user.email, password: user.password }));
  });

  it("password over 72 bytes", async () => {
    const real = `${"a".repeat(70)}1x`;
    const user = await createAccount({ password: real });

    expectInvalid(await post({ email: user.email, password: `${real}extra` }));
    expectInvalid(await post({ email: user.email, password: "p".repeat(128) }));
  });

  it("a failed login does not touch lastLoginAt", async () => {
    const user = await createAccount();

    await post({ email: user.email, password: "Salah-Banget-1" });

    expect((await readUser(user.id)).lastLoginAt).toBeNull();
  });
});

describe("POST /api/auth/login: 400 VALIDATION_ERROR", () => {
  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["missing password", { email: "a@b.id" }],
    ["missing email", { password: "x" }],
    ["empty email", { email: "", password: "x" }],
    ["email over 254 characters", { email: "a".repeat(255), password: "x" }],
    ["empty password", { email: "a@b.id", password: "" }],
    ["password over 128 characters", { email: "a@b.id", password: "p".repeat(129) }],
    ["email is not a string", { email: ["a@b.id"], password: "x" }],
    ["password is an object", { email: "a@b.id", password: { $ne: "" } }],
    ["unknown field", { email: "a@b.id", password: "x", organizationId: "x" }],
  ])("%s", async (_name, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.length).toBeGreaterThan(0);
    for (const detail of res.body.details) {
      expect(detail).toEqual({ source: "body", path: expect.any(String), message: expect.any(String) });
    }
  });

  it("a body that is not JSON", async () => {
    const res = await request(app).post(LOGIN).set("Content-Type", "application/json").send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("a body sent as plain text", async () => {
    const res = await request(app).post(LOGIN).set("Content-Type", "text/plain").send("email=a@b.id");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/login: logs", () => {
  const spies = [];
  afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

  // Collects everything any logger level receives while the callback runs.
  async function captureLogs(callback) {
    const lines = [];
    for (const level of ["info", "warn", "error"]) {
      const spy = jest.spyOn(logger, level).mockImplementation((message, fields) => {
        lines.push(JSON.stringify({ message, ...fields }));
      });
      spies.push(spy);
    }
    await callback();
    return lines.join("\n");
  }

  it("never contain the email, the password or the token", async () => {
    const user = await createAccount({ email: "rahasia.owner@example.com", password: "Sangat-Rahasia-77" });
    let token;

    const logs = await captureLogs(async () => {
      const ok = await post({ email: user.email, password: user.password });
      token = ok.body.token;
      await post({ email: user.email, password: "Salah-Banget-Rahasia-1" });
      await post({ email: "ghost.rahasia@example.com", password: "Salah-Banget-Rahasia-2" });
    });

    expect(logs).toMatch(/\/api\/auth\/login/);
    expect(token).toEqual(expect.any(String));
    for (const secret of [
      "rahasia.owner",
      "ghost.rahasia",
      "Sangat-Rahasia-77",
      "Salah-Banget-Rahasia",
      token,
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
