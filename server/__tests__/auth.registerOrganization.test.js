const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { logger } = require("../helpers/logger");
const organizationAccess = require("../helpers/organizationAccess");
const { COST } = require("../helpers/bcrypt");
const { bcryptPrefix } = require("./support/bcryptPrefix");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createPlan } = require("./support/factories");
const { runConcurrently } = require("./support/concurrency");

jest.setTimeout(30000);

const REGISTER = "/api/auth/register-organization";
const body = (patch = {}) => ({
  organizationName: "Toko Maju",
  slug: "tokomaju",
  name: "Budi Santoso",
  email: "budi@tokomaju.example",
  password: "Gula-Kopi-2026",
  ...patch,
});
const post = (data) => request(app).post(REGISTER).send(data);
const rows = async (table) => (await getSequelize().query(`SELECT * FROM "${table}"`))[0];
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await clearTables(getSequelize());
  await createPlan("Starter");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("POST /api/auth/register-organization: success", () => {
  it("answers 201 with token, user, organization and redirectTo, and is never cached", async () => {
    const res = await post(body({ email: "  Budi@TokoMaju.Example " }));

    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      token: expect.any(String),
      user: { id: expect.any(String), name: "Budi Santoso", email: "budi@tokomaju.example", role: "OWNER" },
      organization: { id: expect.any(String), name: "Toko Maju", slug: "tokomaju", status: "TRIAL" },
      redirectTo: "/dashboard",
    });
  });

  it("creates the three rows with the BL04 period values", async () => {
    const before = Date.now();
    const res = await post(body());
    const after = Date.now();

    const [org] = await rows("Organizations");
    const [owner] = await rows("Users");
    const [sub] = await rows("Subscriptions");
    const [plan] = await rows("Plans");
    expect(org).toMatchObject({ id: res.body.organization.id, name: "Toko Maju", slug: "tokomaju", status: "TRIAL" });
    expect(owner).toMatchObject({ organizationId: org.id, role: "OWNER", isActive: true, email: "budi@tokomaju.example" });
    expect(owner.passwordHash).toMatch(bcryptPrefix(COST));
    expect(sub).toMatchObject({ organizationId: org.id, planId: plan.id, billingDay: null });
    const start = new Date(sub.currentPeriodStart).getTime();
    expect(start).toBeGreaterThanOrEqual(before);
    expect(start).toBeLessThanOrEqual(after);
    expect(new Date(sub.currentPeriodEnd).getTime() - start).toBe(30 * DAY);
    expect(new Date(sub.graceUntil).getTime() - new Date(sub.currentPeriodEnd).getTime()).toBe(3 * DAY);
  });

  it("gives a token that works on GET /api/me", async () => {
    const { body: created } = await post(body());

    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${created.token}`);

    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: created.user.id, role: "OWNER" });
    expect(me.body.organization).toMatchObject({ id: created.organization.id, slug: "tokomaju", status: "TRIAL" });
  });

  it("lets the new Owner log in with the password", async () => {
    await post(body());

    const login = await request(app).post("/api/auth/login").send({ email: "budi@tokomaju.example", password: "Gula-Kopi-2026" });

    expect(login.status).toBe(200);
  });
});

describe("POST /api/auth/register-organization: conflicts", () => {
  it("409 for a duplicate email with different case, and creates nothing", async () => {
    await createAccount({ email: "budi@tokomaju.example" });
    const orgsBefore = (await rows("Organizations")).length;

    const res = await post(body({ email: "BUDI@TokoMaju.example", slug: "tokobaru" }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.details).toEqual([expect.objectContaining({ source: "body", path: "email" })]);
    expect(await rows("Organizations")).toHaveLength(orgsBefore);
    expect(await rows("Subscriptions")).toHaveLength(0);
  });

  it("409 for a duplicate slug, and creates nothing", async () => {
    expect((await post(body())).status).toBe(201);

    const res = await post(body({ email: "lain@tokomaju.example" }));

    expect(res.status).toBe(409);
    expect(res.body.details).toEqual([expect.objectContaining({ source: "body", path: "slug" })]);
    expect(await rows("Organizations")).toHaveLength(1);
    expect(await rows("Users")).toHaveLength(1);
    expect(await rows("Subscriptions")).toHaveLength(1);
  });

  it("two simultaneous sign-ups with the same email: one 201 and one 409", async () => {
    const results = await runConcurrently(2, (i) => post(body({ slug: `toko${i}abc` })));

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await rows("Organizations")).toHaveLength(1);
    expect(await rows("Users")).toHaveLength(1);
    expect(await rows("Subscriptions")).toHaveLength(1);
  });

  it("two simultaneous sign-ups with the same slug: one 201 and one 409", async () => {
    const results = await runConcurrently(2, (i) => post(body({ email: `budi${i}@tokomaju.example` })));

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await rows("Organizations")).toHaveLength(1);
  });
});

describe("POST /api/auth/register-organization: validation", () => {
  it.each([
    ["an invalid slug", { slug: "Toko-Maju" }, "slug"],
    ["a weak password", { password: "short" }, "password"],
    ["a password equal to the email", { password: "budi@tokomaju.example" }, "password"],
    ["an invalid email", { email: "budi" }, "email"],
  ])("400 for %s", async (_label, patch, path) => {
    const res = await post(body(patch));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.map((d) => d.path)).toContain(path);
    expect(await rows("Organizations")).toHaveLength(0);
  });

  it("400 for an unknown field such as status or organizationId", async () => {
    const res = await post(body({ status: "ACTIVE", organizationId: "x" }));

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toEqual(expect.arrayContaining(["status", "organizationId"]));
  });
});

describe("POST /api/auth/register-organization: atomicity", () => {
  afterEach(() => jest.restoreAllMocks());

  it("leaves no Organization, User or Subscription when the last insert fails", async () => {
    jest.spyOn(organizationAccess, "insertSubscription").mockRejectedValue(new Error("boom"));

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(await rows("Organizations")).toHaveLength(0);
    expect(await rows("Users")).toHaveLength(0);
    expect(await rows("Subscriptions")).toHaveLength(0);
  });

  it("answers 500 and creates nothing when the Starter plan is missing", async () => {
    await getSequelize().query('DELETE FROM "Plans"');

    const res = await post(body());

    expect(res.status).toBe(500);
    expect(await rows("Organizations")).toHaveLength(0);
  });
});

describe("POST /api/auth/register-organization: logs", () => {
  afterEach(() => jest.restoreAllMocks());

  it("never contain the password, the email or the token", async () => {
    const lines = [];
    for (const level of ["info", "warn", "error"]) {
      jest.spyOn(logger, level).mockImplementation((message, fields) => lines.push(JSON.stringify({ message, ...fields })));
    }

    const res = await post(body({ email: "rahasia.budi@tokomaju.example", password: "Sangat-Rahasia-77" }));
    await post(body({ email: "rahasia.budi@tokomaju.example", password: "Sangat-Rahasia-77" }));
    const logs = lines.join("\n");

    expect(logs).toMatch(/register-organization/);
    for (const secret of ["rahasia.budi", "Sangat-Rahasia-77", res.body.token]) expect(logs).not.toContain(secret);
  });
});
