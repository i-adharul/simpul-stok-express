const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const env = require("../config/env");
const db = require("../models");
const authentication = require("../middlewares/authentication");
const { errorHandler, notFoundHandler } = require("../middlewares/errorHandler");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");

jest.setTimeout(30000);

// One protected route that shows what the middleware put on the request.
const app = express();
app.get("/protected", authentication, (req, res) => res.json({ user: req.user }));
app.use(notFoundHandler);
app.use(errorHandler);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const UNAUTHENTICATED = {
  code: "UNAUTHENTICATED",
  message: "Sesi tidak valid. Silakan masuk lagi.",
  details: null,
};
const get = (authorization) => {
  const req = request(app).get("/protected");
  return authorization === undefined ? req : req.set("Authorization", authorization);
};
const expectRejected = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toEqual(UNAUTHENTICATED);
};

describe("authentication: a valid token", () => {
  it("loads the user from the database and puts it on req.user", async () => {
    const user = await createAccount({ role: "WAREHOUSE_ADMIN" });

    const res = await get(`Bearer ${signToken(user.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      name: "Budi Owner",
      role: "WAREHOUSE_ADMIN",
      organizationId: user.organizationId,
    });
  });

  it("never exposes the password hash", async () => {
    const user = await createAccount();

    const res = await get(`Bearer ${signToken(user.id)}`);

    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("takes the role from the database, not from the token", async () => {
    const user = await createAccount({ role: "VIEWER" });
    const token = jwt.sign({ role: "OWNER", organizationId: "x" }, env.JWT_SECRET, {
      subject: user.id,
      expiresIn: "8h",
    });

    const res = await get(`Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("VIEWER");
    expect(res.body.user.organizationId).toBe(user.organizationId);
  });

  it("accepts the scheme in any letter case", async () => {
    const user = await createAccount();

    expect((await get(`bearer ${signToken(user.id)}`)).status).toBe(200);
  });
});

describe("authentication: every failure is the same 401", () => {
  it("no Authorization header", async () => {
    expectRejected(await get());
  });

  it.each([
    ["an empty header", ""],
    ["only the scheme", "Bearer"],
    ["only the scheme and a space", "Bearer "],
    ["another scheme", "Basic dXNlcjpwYXNz"],
    ["no scheme", "abc.def.ghi"],
    ["two tokens", "Bearer a.b.c d.e.f"],
  ])("%s", async (_name, header) => {
    expectRejected(await get(header));
  });

  it("a token that is not a JWT", async () => {
    expectRejected(await get("Bearer garbage"));
  });

  it("a token signed with another secret", async () => {
    const user = await createAccount();
    const forged = jwt.sign({}, "x".repeat(40), { subject: user.id, expiresIn: "8h" });

    expectRejected(await get(`Bearer ${forged}`));
  });

  it("a token with a changed payload", async () => {
    const user = await createAccount();
    const other = await createAccount({ email: "other@example.com", organizationId: user.organizationId });
    const [header, , signature] = signToken(user.id).split(".");
    const payload = Buffer.from(JSON.stringify({ sub: other.id, iat: 1, exp: 9999999999 })).toString("base64url");

    expectRejected(await get(`Bearer ${header}.${payload}.${signature}`));
  });

  it("an unsigned token (alg none)", async () => {
    const user = await createAccount();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: user.id })).toString("base64url");

    expectRejected(await get(`Bearer ${header}.${body}.`));
  });

  it("an expired token", async () => {
    const user = await createAccount();

    expectRejected(await get(`Bearer ${signToken(user.id, "-1s")}`));
  });

  it("an inactive user with a valid token", async () => {
    const user = await createAccount({ isActive: false });

    expectRejected(await get(`Bearer ${signToken(user.id)}`));
  });

  it("a user who no longer exists", async () => {
    expectRejected(await get(`Bearer ${signToken("6f1c3a52-0d8c-4a7e-9f0e-1c6b0a1b2c3d")}`));
  });

  it("a subject that is not a UUID (no database error)", async () => {
    expectRejected(await get(`Bearer ${signToken("not-a-uuid")}`));
  });

  it("a token without a subject", async () => {
    const token = jwt.sign({}, env.JWT_SECRET, { expiresIn: "8h" });

    expectRejected(await get(`Bearer ${token}`));
  });
});

describe("authentication: a token issued before the last password change", () => {
  const sign = (userId, iat) =>
    jwt.sign({ iat }, env.JWT_SECRET, { subject: userId, expiresIn: "8h" });
  const NOW = Math.floor(Date.now() / 1000);

  it("is rejected when it was issued seconds before the change", async () => {
    const changedAt = new Date((NOW - 10) * 1000);
    const user = await createAccount({ passwordChangedAt: changedAt });

    expectRejected(await get(`Bearer ${sign(user.id, NOW - 20)}`));
    expectRejected(await get(`Bearer ${sign(user.id, NOW - 11)}`));
  });

  it("is accepted when it was issued in the same second as the change (known limit)", async () => {
    // passwordChangedAt has milliseconds; the comparison uses whole seconds, so the token of the
    // second in which the password changed still works. Documented in docs/04, Authentication.
    const changedAt = new Date((NOW - 10) * 1000 + 900);
    const user = await createAccount({ passwordChangedAt: changedAt });

    const res = await get(`Bearer ${sign(user.id, NOW - 10)}`);

    expect(res.status).toBe(200);
  });

  it("is accepted when it was issued after the change", async () => {
    const user = await createAccount({ passwordChangedAt: new Date((NOW - 10) * 1000) });

    expect((await get(`Bearer ${sign(user.id, NOW - 9)}`)).status).toBe(200);
    expect((await get(`Bearer ${signToken(user.id)}`)).status).toBe(200);
  });

  it("does not matter when the password was never changed", async () => {
    const user = await createAccount({ passwordChangedAt: null });

    expect((await get(`Bearer ${sign(user.id, NOW - 3600)}`)).status).toBe(200);
  });
});

describe("issuedBeforePasswordChange", () => {
  const { issuedBeforePasswordChange } = authentication;

  it("compares whole seconds", () => {
    const changedAt = new Date("2026-11-05T10:00:00.900Z");
    const second = Math.floor(changedAt.getTime() / 1000);

    expect(issuedBeforePasswordChange(second - 1, changedAt)).toBe(true);
    expect(issuedBeforePasswordChange(second, changedAt)).toBe(false);
    expect(issuedBeforePasswordChange(second + 1, changedAt)).toBe(false);
  });

  it("is false when there is no change date", () => {
    expect(issuedBeforePasswordChange(1, null)).toBe(false);
    expect(issuedBeforePasswordChange(1, undefined)).toBe(false);
  });

  it("is true when the token has no usable issue time but a change date exists", () => {
    expect(issuedBeforePasswordChange(undefined, new Date())).toBe(true);
    expect(issuedBeforePasswordChange("1", new Date())).toBe(true);
  });
});
