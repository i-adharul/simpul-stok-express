// BL01 (login and session), proven through the real endpoints: a person logs in, uses the token,
// and something happens to the account or the clock. The unit-level cases live in
// authentication.test.js and me.test.js; this file keeps the three session rules in one place.
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const env = require("../config/env");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");

jest.setTimeout(30000);

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const login = async (account) => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: account.email, password: account.password });
  expect(res.status).toBe(200);
  return res.body.token;
};
const me = (token) => request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
const changePassword = (token, body) =>
  request(app).patch("/api/me/password").set("Authorization", `Bearer ${token}`).send(body);
const expectSessionEnded = (res) => {
  expect(res.status).toBe(401);
  expect(res.body).toEqual(UNAUTHENTICATED);
};

describe("BL01: a user deactivated mid-session is rejected", () => {
  it("the token that worked a moment ago stops working at once", async () => {
    const account = await createAccount();
    const token = await login(account);
    expect((await me(token)).status).toBe(200);

    await getSequelize().query('UPDATE "Users" SET "isActive" = false WHERE "id" = :id', {
      replacements: { id: account.id },
    });

    expectSessionEnded(await me(token));
  });

  it("every protected endpoint refuses the deactivated user, not only /api/me", async () => {
    const account = await createAccount();
    const token = await login(account);
    await getSequelize().query('UPDATE "Users" SET "isActive" = false');

    expectSessionEnded(await me(token));
    expectSessionEnded(
      await changePassword(token, { currentPassword: account.password, newPassword: "Kopi-Susu-2027" }),
    );
  });

  it("the token is still unexpired: it is the database, not the clock, that ends the session", async () => {
    const account = await createAccount();
    const token = await login(account);
    await getSequelize().query('UPDATE "Users" SET "isActive" = false');

    const { exp } = jwt.decode(token);

    expect(exp * 1000).toBeGreaterThan(Date.now());
    expectSessionEnded(await me(token));
  });

  it("only that user is affected: a colleague in the same organization keeps working", async () => {
    const owner = await createAccount({ email: "owner@example.com" });
    const viewer = await createAccount({
      email: "viewer@example.com",
      role: "VIEWER",
      organizationId: owner.organizationId,
    });
    const [ownerToken, viewerToken] = [await login(owner), await login(viewer)];

    await getSequelize().query('UPDATE "Users" SET "isActive" = false WHERE "id" = :id', {
      replacements: { id: viewer.id },
    });

    expect((await me(ownerToken)).status).toBe(200);
    expectSessionEnded(await me(viewerToken));
  });

  it("the deactivated user cannot log in again, with the same answer as a wrong password", async () => {
    const account = await createAccount();
    await getSequelize().query('UPDATE "Users" SET "isActive" = false');

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: account.password });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("the server keeps no session: reactivating the user makes the same unexpired token work again", async () => {
    // A known consequence of ADR 0009. The test documents it so a change in behaviour is deliberate.
    const account = await createAccount();
    const token = await login(account);
    await getSequelize().query('UPDATE "Users" SET "isActive" = false');
    expectSessionEnded(await me(token));

    await getSequelize().query('UPDATE "Users" SET "isActive" = true');

    expect((await me(token)).status).toBe(200);
  });
});

describe("BL01: an expired token is rejected", () => {
  it("a login token lasts exactly 8 hours", async () => {
    const account = await createAccount();

    const { iat, exp } = jwt.decode(await login(account));

    expect(exp - iat).toBe(8 * 60 * 60);
  });

  it("a token that expires while the user is working is refused once the time has passed", async () => {
    const account = await createAccount();
    const token = signToken(account.id, "1s");
    expect((await me(token)).status).toBe(200);

    await sleep(2100);

    expectSessionEnded(await me(token));
  });

  it("a token whose expiry is already in the past is refused", async () => {
    const account = await createAccount();

    expectSessionEnded(await me(signToken(account.id, "-1s")));
    expectSessionEnded(await me(signToken(account.id, -3600)));
  });

  it("an expired token is refused on every protected endpoint", async () => {
    const account = await createAccount();
    const expired = signToken(account.id, "-1s");

    expectSessionEnded(await me(expired));
    expectSessionEnded(
      await changePassword(expired, { currentPassword: account.password, newPassword: "Kopi-Susu-2027" }),
    );
  });

  it("the expiry cannot be extended by editing the token", async () => {
    const account = await createAccount();
    const [header, , signature] = signToken(account.id, "-1s").split(".");
    const payload = Buffer.from(
      JSON.stringify({ sub: account.id, iat: 1, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");

    expectSessionEnded(await me(`${header}.${payload}.${signature}`));
  });

  it("using the token does not extend it: no new token is issued and the old expiry stands", async () => {
    const account = await createAccount();
    const token = await login(account);
    const before = jwt.decode(token);

    const res = await me(token);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("token");
    expect(res.headers).not.toHaveProperty("authorization");
    expect(res.headers).not.toHaveProperty("set-cookie");
    expect(jwt.decode(token).exp).toBe(before.exp);
  });

  it("an expired token can still call logout (always 204), but it opens nothing else", async () => {
    const account = await createAccount();
    const expired = signToken(account.id, "-1s");

    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(204);
    expectSessionEnded(await me(expired));
  });

  it("a token signed with the right secret but for 8 hours ago plus a second is refused", async () => {
    const account = await createAccount();
    const issued = Math.floor(Date.now() / 1000) - 8 * 60 * 60 - 1;
    const token = jwt.sign({ iat: issued }, env.JWT_SECRET, { subject: account.id, expiresIn: "8h" });

    expectSessionEnded(await me(token));
  });
});
