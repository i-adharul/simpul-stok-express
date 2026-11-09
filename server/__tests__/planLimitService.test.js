const db = require("../models");
const { inTransaction } = require("../helpers/transaction");
const planLimit = require("../services/planLimitService");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");

jest.setTimeout(60000);

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLANS = {
  Starter: { WAREHOUSE: 2, PRODUCT: 100, MEMBER: 3 },
  Business: { WAREHOUSE: 10, PRODUCT: 500, MEMBER: 10 },
};
const planId = {};
let orgA;
let orgB;

async function makePlans() {
  for (const [name, l] of Object.entries(PLANS)) {
    const [row] = await sql(
      `INSERT INTO "Plans" ("name","priceIdr","maxWarehouses","maxProducts","maxMembers") VALUES (:name, 1000, :w, :p, :m) RETURNING "id"`,
      { name, w: l.WAREHOUSE, p: l.PRODUCT, m: l.MEMBER },
    );
    planId[name] = row.id;
  }
}
const subscribe = (organizationId, plan) =>
  sql(
    `INSERT INTO "Subscriptions" ("organizationId","planId","currentPeriodStart","currentPeriodEnd","graceUntil")
     VALUES (:organizationId, :planId, now(), now() + interval '30 days', now() + interval '33 days')`,
    { organizationId, planId: planId[plan] },
  );

// Raw bulk inserts, so the tests do not depend on the code they check.
const addWarehouses = (organizationId, n, archived = false) =>
  sql(
    `INSERT INTO "Warehouses" ("organizationId","code","name","archivedAt")
     SELECT :organizationId, upper(:prefix || substr(md5(random()::text || g::text), 1, 12)), 'Gudang ' || g, CASE WHEN :archived THEN now() ELSE NULL END FROM generate_series(1, :n) g`,
    { organizationId, n, archived, prefix: archived ? "OLD-" : "GD-" },
  );
const addProducts = (organizationId, n, archived = false) =>
  sql(
    `INSERT INTO "Products" ("organizationId","sku","name","unit","archivedAt")
     SELECT :organizationId, upper(:prefix || substr(md5(random()::text || g::text), 1, 12)), 'Produk ' || g, 'pcs', CASE WHEN :archived THEN now() ELSE NULL END FROM generate_series(1, :n) g`,
    { organizationId, n, archived, prefix: archived ? "OLD-" : "SKU-" },
  );
const addUsers = (organizationId, n, { active = true, role = "VIEWER", prefix = "u" } = {}) =>
  sql(
    `INSERT INTO "Users" ("organizationId","email","name","passwordHash","role","isActive")
     SELECT :organizationId, :prefix || substr(md5(random()::text || g::text), 1, 12) || '@x.test', 'User ' || g, 'hash', CAST(:role AS "enum_Users_role"), :active FROM generate_series(1, :n) g`,
    { organizationId, n, active, role, prefix },
  );
const ADD = { WAREHOUSE: addWarehouses, PRODUCT: addProducts, MEMBER: (org, n) => addUsers(org, n) };
const check = (organizationId, resource) => inTransaction((transaction) => planLimit.assertWithinLimit(organizationId, resource, { transaction }));

beforeEach(async () => {
  await clearTables(getSequelize());
  await makePlans();
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("getUsage", () => {
  it("counts non-archived warehouses and products and ACTIVE users, the Owner included", async () => {
    await addWarehouses(orgA, 2);
    await addWarehouses(orgA, 3, true);
    await addProducts(orgA, 4);
    await addProducts(orgA, 5, true);
    await addUsers(orgA, 1, { role: "OWNER", prefix: "owner" });
    await addUsers(orgA, 2);
    await addUsers(orgA, 4, { active: false, prefix: "gone" });

    expect(await planLimit.getUsage(orgA)).toEqual({ WAREHOUSE: 2, PRODUCT: 4, MEMBER: 3 });
  });

  it("never counts another organization", async () => {
    await addWarehouses(orgB, 3);
    await addProducts(orgB, 3);
    await addUsers(orgB, 3);

    expect(await planLimit.getUsage(orgA)).toEqual({ WAREHOUSE: 0, PRODUCT: 0, MEMBER: 0 });
  });

  it("does not count a pending invitation as a member", async () => {
    const [owner] = await sql(
      `INSERT INTO "Users" ("organizationId","email","name","passwordHash","role") VALUES (:orgA,'o@x.test','O','hash','OWNER') RETURNING "id"`,
      { orgA },
    );
    await sql(
      `INSERT INTO "Invitations" ("organizationId","email","role","tokenHash","expiresAt","createdById")
       VALUES (:orgA,'p@x.test','VIEWER','h1', now() + interval '7 days', :by)`,
      { orgA, by: owner.id },
    );

    expect((await planLimit.getUsage(orgA)).MEMBER).toBe(1);
  });
});

describe("getPlanLimits and getEffectiveLimits", () => {
  it.each(Object.entries(PLANS))("reads the limits of the %s plan", async (name, limits) => {
    await subscribe(orgA, name);

    expect(await planLimit.getPlanLimits(orgA)).toEqual(limits);
    expect(await planLimit.getEffectiveLimits(orgA)).toEqual(limits);
  });

  it("a trial (a subscription that points at Starter) uses the Starter limits", async () => {
    await sql(`UPDATE "Organizations" SET "status" = 'TRIAL' WHERE "id" = :orgA`, { orgA });
    await subscribe(orgA, "Starter");

    expect(await planLimit.getPlanLimits(orgA)).toEqual(PLANS.Starter);
  });

  it("an organization without a subscription is held to Starter, and Business never leaks across organizations", async () => {
    await subscribe(orgB, "Business");

    expect(await planLimit.getPlanLimits(orgA)).toEqual(PLANS.Starter);
    expect(await planLimit.getPlanLimits(orgB)).toEqual(PLANS.Business);
  });

  it("is a 500 when there is neither a subscription nor a Starter plan (broken seed data)", async () => {
    await sql('DELETE FROM "Plans"');

    await expect(planLimit.getPlanLimits(orgA)).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
  });
});

describe("assertWithinLimit", () => {
  const cases = [];
  for (const [plan, limits] of Object.entries(PLANS)) {
    for (const [resource, limit] of Object.entries(limits)) cases.push([plan, resource, limit]);
  }

  it.each(cases)("%s %s: one below the limit passes, exactly at the limit is refused", async (plan, resource, limit) => {
    await subscribe(orgA, plan);
    await ADD[resource](orgA, limit - 1);
    await expect(check(orgA, resource)).resolves.toBeUndefined();

    await ADD[resource](orgA, 1);
    await expect(check(orgA, resource)).rejects.toMatchObject({
      status: 403,
      code: "PLAN_LIMIT_REACHED",
      details: { resource, limit, used: limit },
    });
  });

  it("an organization far below its limit passes, and one above it (data from before) is refused", async () => {
    await subscribe(orgA, "Starter");
    await addWarehouses(orgA, 5);

    await expect(check(orgB, "WAREHOUSE")).resolves.toBeUndefined();
    await expect(check(orgA, "WAREHOUSE")).rejects.toMatchObject({ details: { resource: "WAREHOUSE", limit: 2, used: 5 } });
  });

  it("the message is Indonesian and names the resource and the numbers", async () => {
    await subscribe(orgA, "Starter");
    await addWarehouses(orgA, 2);

    await expect(check(orgA, "WAREHOUSE")).rejects.toMatchObject({
      message: "Batas gudang pada paket Anda sudah tercapai (2 dari 2).",
    });
  });

  it("the body of the error is { code, message, details } with no stack", async () => {
    await subscribe(orgA, "Starter");
    await addProducts(orgA, 100);

    const error = await check(orgA, "PRODUCT").catch((e) => e);

    expect(error.toBody()).toEqual({
      code: "PLAN_LIMIT_REACHED",
      message: "Batas produk pada paket Anda sudah tercapai (100 dari 100).",
      details: { resource: "PRODUCT", limit: 100, used: 100 },
    });
  });

  it("a programming error, not a client error: no transaction, or an unknown resource", async () => {
    await expect(planLimit.assertWithinLimit(orgA, "WAREHOUSE")).rejects.toThrow(/inside a transaction/);
    await expect(check(orgA, "STOCK")).rejects.toThrow(/Unknown plan resource/);
  });
});

describe("lockOrganization", () => {
  it("a second transaction that checks the limit waits until the first one has finished", async () => {
    await subscribe(orgA, "Starter");
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let held;
    const locked = new Promise((resolve) => (held = resolve));
    const holder = inTransaction(async (transaction) => {
      await planLimit.lockOrganization(orgA, transaction);
      held();
      await gate;
    });
    await locked;

    let settled = false;
    const waiting = check(orgA, "WAREHOUSE").then(() => (settled = true));
    await sleep(400);
    expect(settled).toBe(false);

    release();
    await holder;
    await waiting;
    expect(settled).toBe(true);
  });

  it("does not block another organization", async () => {
    await subscribe(orgA, "Starter");
    await subscribe(orgB, "Starter");
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let held;
    const locked = new Promise((resolve) => (held = resolve));
    const holder = inTransaction(async (transaction) => {
      await planLimit.lockOrganization(orgA, transaction);
      held();
      await gate;
    });
    await locked;

    await expect(check(orgB, "WAREHOUSE")).resolves.toBeUndefined();

    release();
    await holder;
  });

  it("must run inside a transaction, and a missing organization is a 500", async () => {
    await expect(planLimit.lockOrganization(orgA)).rejects.toThrow(/inside a transaction/);
    await expect(
      inTransaction((transaction) => planLimit.lockOrganization("99999999-9999-4999-8999-999999999999", transaction)),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
