const jwt = require("jsonwebtoken");
const request = require("supertest");

// The validated env is frozen, so the switch is tested through a mutable copy of it. Every module that
// reads `config/env` gets this same object (jest.mock is hoisted above the requires below).
const mockEnv = {};
jest.mock("../config/env", () => Object.assign(mockEnv, jest.requireActual("../config/env")));

const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

const URL = "/api/auth/demo-login";
const NOT_FOUND = { code: "NOT_FOUND", message: "Data tidak ditemukan.", details: null };
const EMAILS = {
  OWNER: "owner@example.com",
  WAREHOUSE_ADMIN: "admin@example.com",
  VIEWER: "viewer@example.com",
};
const post = (body) => request(app).post(URL).send(body);

// One organization with the three demo accounts, like the seed makes them.
async function createDemoAccounts() {
  const organizationId = await createOrganization("tokomaju");
  const users = {};
  for (const [role, email] of Object.entries(EMAILS)) {
    users[role] = await createAccount({ email, role, organizationId, name: `Demo ${role}` });
  }
  return users;
}

beforeEach(async () => {
  await clearTables(getSequelize());
  Object.assign(mockEnv, {
    DEMO_MODE: true,
    DEMO_OWNER_EMAIL: EMAILS.OWNER,
    DEMO_ADMIN_EMAIL: EMAILS.WAREHOUSE_ADMIN,
    DEMO_VIEWER_EMAIL: EMAILS.VIEWER,
  });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("POST /api/auth/demo-login: DEMO_MODE off", () => {
  beforeEach(() => {
    mockEnv.DEMO_MODE = false;
  });

  it("answers 404 for a valid body, with the body of an unknown route", async () => {
    await createDemoAccounts();

    const res = await post({ role: "OWNER" });
    const unknown = await request(app).post("/api/auth/does-not-exist").send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    expect(res.body).toEqual(unknown.body);
  });

  it("answers 404 for an invalid body too, so the route is not announced", async () => {
    for (const body of [{}, { role: "PLATFORM_ADMIN" }, { role: "OWNER", email: "x@example.com" }]) {
      const res = await post(body);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
  });

  it("issues no token and does not touch the account", async () => {
    const users = await createDemoAccounts();

    const res = await post({ role: "OWNER" });

    expect(res.body.token).toBeUndefined();
    expect((await readUser(users.OWNER.id)).lastLoginAt).toBeNull();
  });
});

describe("POST /api/auth/demo-login: the three roles", () => {
  it.each(Object.keys(EMAILS))("signs in as %s with the shape of login, never cached", async (role) => {
    const users = await createDemoAccounts();

    const res = await post({ role });

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: users[role].id, name: `Demo ${role}`, email: EMAILS[role], role },
      redirectTo: "/dashboard",
    });
    expect((await readUser(users[role].id)).lastLoginAt).not.toBeNull();
  });

  it("issues a JWT with only sub, iat and exp, valid for 8 hours even when JWT_EXPIRES_IN says otherwise", async () => {
    const users = await createDemoAccounts();
    mockEnv.JWT_EXPIRES_IN = "1h";

    const { body } = await post({ role: "VIEWER" });
    const payload = jwt.decode(body.token);

    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(users.VIEWER.id);
    expect(payload.exp - payload.iat).toBe(8 * 60 * 60);
  });

  it.each(Object.keys(EMAILS))("gives a %s token that GET /api/me accepts", async (role) => {
    const users = await createDemoAccounts();
    const { body } = await post({ role });

    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${body.token}`);

    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: users[role].id, name: `Demo ${role}`, email: EMAILS[role], role, isDemo: true });
    expect(me.body.organization.slug).toBe("tokomaju");
  });
});

describe("POST /api/auth/demo-login: what is refused", () => {
  it("answers 400 for the platform admin role, and no token", async () => {
    await createDemoAccounts();
    await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" });

    const res = await post({ role: "PLATFORM_ADMIN" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([expect.objectContaining({ source: "body", path: "role" })]);
    expect(res.body.token).toBeUndefined();
  });

  it.each([
    ["no role", {}],
    ["an unknown role", { role: "SUPERUSER" }],
    ["a lowercase role", { role: "owner" }],
    ["a role that is not a string", { role: 1 }],
    ["an email instead of a role", { email: "owner@example.com" }],
    ["an email next to a role", { role: "OWNER", email: "platform@example.com" }],
    ["an organizationId", { role: "OWNER", organizationId: "00000000-0000-4000-8000-000000000000" }],
  ])("answers 400 for %s", async (_label, body) => {
    await createDemoAccounts();

    const res = await post(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 400 when the body is not JSON", async () => {
    const res = await request(app).post(URL).set("Content-Type", "application/json").send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 404 for an inactive demo account", async () => {
    const users = await createDemoAccounts();
    await getSequelize().query(`UPDATE "Users" SET "isActive" = false WHERE id = :id`, { replacements: { id: users.OWNER.id } });

    const res = await post({ role: "OWNER" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it("answers 404 when the configured account does not exist", async () => {
    await createDemoAccounts();
    mockEnv.DEMO_VIEWER_EMAIL = "nobody@example.com";

    expect((await post({ role: "VIEWER" })).status).toBe(404);
  });

  it("never signs in the platform admin, even when its email is configured for a role", async () => {
    await createDemoAccounts();
    await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" });
    mockEnv.DEMO_OWNER_EMAIL = "platform@example.com";

    const res = await post({ role: "OWNER" });

    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
  });

  it("does not sign in an email outside the list: another user of the same organization stays out", async () => {
    const users = await createDemoAccounts();
    await createAccount({ email: "other@example.com", role: "OWNER", organizationId: users.OWNER.organizationId });

    for (const role of Object.keys(EMAILS)) {
      const res = await post({ role });
      expect(res.body.user?.email).toBe(EMAILS[role]);
    }
  });

  it("does not sign in an account that holds another role than the configured one", async () => {
    await createDemoAccounts();
    mockEnv.DEMO_ADMIN_EMAIL = EMAILS.VIEWER; // the admin button would open the viewer's account

    expect((await post({ role: "WAREHOUSE_ADMIN" })).status).toBe(404);
  });
});
