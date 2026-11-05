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
