const request = require("supertest");

// The validated env is frozen, so the demo switch is tested through a mutable copy of it (every module
// that reads `config/env` gets this same object; jest.mock is hoisted above the requires below).
const mockEnv = {};
jest.mock("../config/env", () => Object.assign(mockEnv, jest.requireActual("../config/env")));

const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { createOrganization, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(60000);

// BL31: the three shared demo accounts cannot change their password, get a reset link, be deactivated or
// have their role changed, whoever asks (the demo Owner included); a regular member of the same
// organization is changed normally.
const PROTECTED = { code: "DEMO_ACCOUNT_PROTECTED", message: "Akun demo tidak dapat diubah.", details: null };
let users;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const as = (key) => ({ Authorization: `Bearer ${signToken(users[key].id)}` });
const patchMember = (id, body, caller = "DEMO_OWNER") => request(app).patch(`/api/members/${id}`).set(as(caller)).send(body);
const resetLink = (id, caller = "DEMO_OWNER") => request(app).post(`/api/members/${id}/reset-link`).set(as(caller)).send({});
const changePassword = (caller, newPassword = "Kopi-Susu-Gula-2026") =>
  request(app).patch("/api/me/password").set(as(caller)).send({ currentPassword: users[caller].password, newPassword });

beforeEach(async () => {
  await clearTables(getSequelize());
  Object.assign(mockEnv, {
    DEMO_MODE: true,
    DEMO_OWNER_EMAIL: "owner@example.com",
    DEMO_ADMIN_EMAIL: "admin@example.com",
    DEMO_VIEWER_EMAIL: "viewer@example.com",
  });
  const organizationId = await createOrganization("tokomaju");
  const other = await createOrganization("tokolain");
  await giveRoomyPlan(organizationId, other);
  users = {
    DEMO_OWNER: await createAccount({ email: "owner@example.com", role: "OWNER", organizationId }),
    DEMO_ADMIN: await createAccount({ email: "admin@example.com", role: "WAREHOUSE_ADMIN", organizationId }),
    DEMO_VIEWER: await createAccount({ email: "viewer@example.com", role: "VIEWER", organizationId }),
    REGULAR_ADMIN: await createAccount({ email: "sari@example.com", role: "WAREHOUSE_ADMIN", organizationId }),
    REGULAR_VIEWER: await createAccount({ email: "dewi@example.com", role: "VIEWER", organizationId }),
    FOREIGN_VIEWER: await createAccount({ email: "viewer@tokolain.example.com", role: "VIEWER", organizationId: other }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("a demo account cannot change its own password", () => {
  it.each(["DEMO_OWNER", "DEMO_ADMIN", "DEMO_VIEWER"])("%s gets 403 DEMO_ACCOUNT_PROTECTED, and nothing changes", async (key) => {
    const before = await readUser(users[key].id);

    const res = await changePassword(key);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
    const after = await readUser(users[key].id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordChangedAt).toBeNull();
  });

  it("is refused before the current password is checked, so a wrong current password gives the same 403", async () => {
    const res = await request(app)
      .patch("/api/me/password")
      .set(as("DEMO_ADMIN"))
      .send({ currentPassword: "not-the-password", newPassword: "Kopi-Susu-Gula-2026" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DEMO_ACCOUNT_PROTECTED");
  });

  it("still lets a regular member of the same organization change theirs", async () => {
    const res = await changePassword("REGULAR_ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect((await readUser(users.REGULAR_ADMIN.id)).passwordChangedAt).not.toBeNull();
  });
});

describe("a demo account cannot get a reset link", () => {
  it.each(["DEMO_ADMIN", "DEMO_VIEWER"])("the demo Owner asks for the link of %s: 403, and no link is stored", async (key) => {
    const res = await resetLink(users[key].id);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
    const [row] = await sql(`SELECT "resetTokenHash", "resetExpiresAt" FROM "Users" WHERE id = :id`, { id: users[key].id });
    expect(row).toEqual({ resetTokenHash: null, resetExpiresAt: null });
  });

  it("the demo Owner asking for their own link is the same 403, not the Owner 409", async () => {
    const res = await resetLink(users.DEMO_OWNER.id);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
  });

  it("a regular member of the same organization still gets one", async () => {
    const res = await resetLink(users.REGULAR_VIEWER.id);

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
  });
});

describe("a demo account cannot be deactivated", () => {
  it.each(["DEMO_ADMIN", "DEMO_VIEWER"])("the demo Owner deactivates %s: 403, and it stays active", async (key) => {
    const res = await patchMember(users[key].id, { isActive: false });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
    expect((await readUser(users[key].id)).isActive).toBe(true);
  });

  it("a regular member is deactivated normally", async () => {
    const res = await patchMember(users.REGULAR_ADMIN.id, { isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect((await readUser(users.REGULAR_ADMIN.id)).isActive).toBe(false);
  });
});

describe("a demo account cannot have its role changed", () => {
  it.each([
    ["DEMO_ADMIN", "VIEWER"],
    ["DEMO_VIEWER", "WAREHOUSE_ADMIN"],
  ])("the demo Owner changes the role of %s to %s: 403, and the role stays", async (key, role) => {
    const before = (await readUser(users[key].id)).role;

    const res = await patchMember(users[key].id, { role });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
    expect((await readUser(users[key].id)).role).toBe(before);
  });

  it("the demo Owner's own row is a demo refusal too, not the Owner 409", async () => {
    const res = await patchMember(users.DEMO_OWNER.id, { role: "VIEWER" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(PROTECTED);
  });

  it("a regular member's role is changed normally", async () => {
    const res = await patchMember(users.REGULAR_VIEWER.id, { role: "WAREHOUSE_ADMIN" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("WAREHOUSE_ADMIN");
  });
});

describe("what is not refused", () => {
  it("repeating the current role of a demo account, or only replacing its warehouses, is allowed", async () => {
    expect((await patchMember(users.DEMO_ADMIN.id, { role: "WAREHOUSE_ADMIN" })).status).toBe(200);
    expect((await patchMember(users.DEMO_ADMIN.id, { warehouseIds: [] })).status).toBe(200);
  });

  it("the roles are judged first: a Warehouse Admin gets 403 FORBIDDEN, not the demo code", async () => {
    const res = await patchMember(users.DEMO_VIEWER.id, { isActive: false }, "REGULAR_ADMIN");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("an ID of another organization is a 404 (rule 2), whatever the demo list says", async () => {
    const patch = await patchMember(users.FOREIGN_VIEWER.id, { isActive: false });
    const link = await resetLink(users.FOREIGN_VIEWER.id);

    expect(patch.status).toBe(404);
    expect(link.status).toBe(404);
    expect((await readUser(users.FOREIGN_VIEWER.id)).isActive).toBe(true);
  });

  it("with DEMO_MODE off nobody is a demo account: the same calls work", async () => {
    mockEnv.DEMO_MODE = false;

    expect((await changePassword("DEMO_VIEWER")).status).toBe(200);
    expect((await resetLink(users.DEMO_ADMIN.id)).status).toBe(201);
    expect((await patchMember(users.DEMO_ADMIN.id, { role: "VIEWER" })).status).toBe(200);
    expect((await patchMember(users.DEMO_VIEWER.id, { isActive: false })).status).toBe(200);
  });
});

describe("the isDemo flag the app reads (GET /api/me and GET /api/members)", () => {
  const me = (caller) => request(app).get("/api/me").set(as(caller));

  it.each([
    ["DEMO_OWNER", true],
    ["DEMO_ADMIN", true],
    ["DEMO_VIEWER", true],
    ["REGULAR_ADMIN", false],
  ])("GET /api/me for %s says isDemo %s", async (key, expected) => {
    expect((await me(key)).body.user.isDemo).toBe(expected);
  });

  it("GET /api/members marks only the demo accounts", async () => {
    const res = await request(app).get("/api/members").set(as("DEMO_OWNER"));

    const flags = Object.fromEntries(res.body.items.map((m) => [m.email, m.isDemo]));
    expect(flags).toEqual({
      "owner@example.com": true,
      "admin@example.com": true,
      "viewer@example.com": true,
      "sari@example.com": false,
      "dewi@example.com": false,
    });
  });

  it("with DEMO_MODE off nobody is flagged", async () => {
    mockEnv.DEMO_MODE = false;

    expect((await me("DEMO_OWNER")).body.user.isDemo).toBe(false);
  });
});

describe("isDemoAccount", () => {
  const { demoEmails, isDemoAccount } = require("../helpers/demoAccounts");

  it("knows the three configured emails, in any letter case, and nobody else", () => {
    expect(isDemoAccount("owner@example.com")).toBe(true);
    expect(isDemoAccount("Admin@Example.COM")).toBe(true);
    expect(isDemoAccount("sari@example.com")).toBe(false);
    expect(isDemoAccount(null)).toBe(false);
    expect(isDemoAccount(undefined)).toBe(false);
  });

  it("is an empty list while DEMO_MODE is off, or when an email is not configured", () => {
    mockEnv.DEMO_MODE = false;
    expect(demoEmails()).toEqual([]);

    mockEnv.DEMO_MODE = true;
    mockEnv.DEMO_VIEWER_EMAIL = null;
    expect(demoEmails()).toEqual(["owner@example.com", "admin@example.com"]);
  });
});
