const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, createPlan, createSubscription } = require("./support/factories");

jest.setTimeout(120000);

// BL20 across the three resources with one table of adapters, so a rule is proven the same way for
// warehouses, products and members: archived (or inactive) rows are not counted, a restore (or a
// reactivation) is counted, freeing a slot frees it, a trial is held to Starter, Business has other
// limits, and the error always has the same shape.
const PLANS = {
  Starter: { WAREHOUSE: 2, PRODUCT: 100, MEMBER: 3 },
  Business: { WAREHOUSE: 10, PRODUCT: 500, MEMBER: 10 },
};
const LABEL = { WAREHOUSE: "gudang", PRODUCT: "produk", MEMBER: "anggota" };

let org;
let owner;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const asOwner = (req) => req.set("Authorization", `Bearer ${signToken(owner.id)}`);
const unique = () => Math.random().toString(36).slice(2, 10).toUpperCase();

// One adapter per resource. `fill(n)` adds n ACTIVE items without a request, `fillOff(n)` adds n
// archived (or inactive) ones, `add()` is the request that adds one more, `free()` archives (or
// deactivates) one active item, `restore()` is the request that brings an off item back (a
// restore of an archived item, or the acceptance of an invitation for an inactive member).
const adapters = {
  WAREHOUSE: {
    ownerCounts: 0,
    fill: (n) =>
      sql(`INSERT INTO "Warehouses" ("organizationId","code","name") SELECT :org, 'A' || upper(substr(md5(random()::text || g::text), 1, 12)), 'Isi' FROM generate_series(1, :n) g`, { org, n }),
    fillOff: (n) =>
      sql(`INSERT INTO "Warehouses" ("organizationId","code","name","archivedAt") SELECT :org, 'X' || upper(substr(md5(random()::text || g::text), 1, 12)), 'Isi', now() FROM generate_series(1, :n) g`, { org, n }),
    add: () => asOwner(request(app).post("/api/warehouses")).send({ code: `N-${unique()}`, name: "Baru" }),
    free: async () => {
      const [row] = await sql(`SELECT id FROM "Warehouses" WHERE "organizationId" = :org AND "archivedAt" IS NULL LIMIT 1`, { org });
      return asOwner(request(app).patch(`/api/warehouses/${row.id}`)).send({ archived: true });
    },
    restore: async () => {
      const [row] = await sql(`SELECT id FROM "Warehouses" WHERE "organizationId" = :org AND "archivedAt" IS NOT NULL LIMIT 1`, { org });
      return asOwner(request(app).patch(`/api/warehouses/${row.id}`)).send({ archived: false });
    },
  },
  PRODUCT: {
    ownerCounts: 0,
    fill: (n) =>
      sql(`INSERT INTO "Products" ("organizationId","sku","name","unit") SELECT :org, 'A' || upper(substr(md5(random()::text || g::text), 1, 12)), 'Isi', 'pcs' FROM generate_series(1, :n) g`, { org, n }),
    fillOff: (n) =>
      sql(`INSERT INTO "Products" ("organizationId","sku","name","unit","archivedAt") SELECT :org, 'X' || upper(substr(md5(random()::text || g::text), 1, 12)), 'Isi', 'pcs', now() FROM generate_series(1, :n) g`, { org, n }),
    add: () => asOwner(request(app).post("/api/products")).send({ sku: `N-${unique()}`, name: "Baru", unit: "pcs" }),
    free: async () => {
      const [row] = await sql(`SELECT id FROM "Products" WHERE "organizationId" = :org AND "archivedAt" IS NULL LIMIT 1`, { org });
      return asOwner(request(app).patch(`/api/products/${row.id}`)).send({ archived: true });
    },
    restore: async () => {
      const [row] = await sql(`SELECT id FROM "Products" WHERE "organizationId" = :org AND "archivedAt" IS NOT NULL LIMIT 1`, { org });
      return asOwner(request(app).patch(`/api/products/${row.id}`)).send({ archived: false });
    },
  },
  // The Owner already counts as one member, so `fill` adds the others.
  MEMBER: {
    ownerCounts: 1,
    fill: (n) =>
      sql(`INSERT INTO "Users" ("organizationId","email","name","passwordHash","role") SELECT :org, substr(md5(random()::text || g::text), 1, 12) || '@x.test', 'Isi', 'hash', 'VIEWER' FROM generate_series(1, :n) g`, { org, n }),
    fillOff: (n) =>
      sql(`INSERT INTO "Users" ("organizationId","email","name","passwordHash","role","isActive") SELECT :org, 'off' || substr(md5(random()::text || g::text), 1, 12) || '@x.test', 'Off', 'hash', 'VIEWER', false FROM generate_series(1, :n) g`, { org, n }),
    add: () => asOwner(request(app).post("/api/invitations")).send({ email: `n-${unique().toLowerCase()}@example.com`, role: "VIEWER" }),
    free: async () => {
      const [row] = await sql(`SELECT id FROM "Users" WHERE "organizationId" = :org AND "isActive" AND "role" = 'VIEWER' LIMIT 1`, { org });
      return asOwner(request(app).patch(`/api/members/${row.id}`)).send({ isActive: false });
    },
    // Reactivation goes through a new invitation: it is created while there is room by the caller.
    restore: async () => {
      const [row] = await sql(`SELECT email FROM "Users" WHERE "organizationId" = :org AND NOT "isActive" LIMIT 1`, { org });
      return { email: row.email };
    },
  },
};

// Brings an organization to exactly `target` ACTIVE items of a resource (the Owner counts as a member).
const fillTo = (resource, target) => adapters[resource].fill(target - adapters[resource].ownerCounts);

async function setup(planName) {
  await clearTables(getSequelize());
  const plans = {};
  for (const [name, l] of Object.entries(PLANS)) {
    plans[name] = await createPlan(name, { maxWarehouses: l.WAREHOUSE, maxProducts: l.PRODUCT, maxMembers: l.MEMBER });
  }
  org = await createOrganization("tokoa");
  await createSubscription(org, plans[planName]);
  owner = await createAccount({ email: "owner@example.com", role: "OWNER", organizationId: org });
}
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const resources = Object.keys(adapters);
const planCases = Object.entries(PLANS).flatMap(([plan, limits]) => resources.map((resource) => [plan, resource, limits[resource]]));

describe.each(planCases)("%s %s (limit %i)", (plan, resource, limit) => {
  const a = adapters[resource];
  beforeEach(() => setup(plan));

  it("archived (inactive) rows are not counted: one slot is left however many are archived", async () => {
    await a.fillOff(7);
    await fillTo(resource, limit - 1);

    expect((await a.add()).status).toBe(201);
  });

  it("exactly at the limit is refused with the documented error shape", async () => {
    await a.fillOff(2);
    await fillTo(resource, limit);

    const res = await a.add();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      code: "PLAN_LIMIT_REACHED",
      message: `Batas ${LABEL[resource]} pada paket Anda sudah tercapai (${limit} dari ${limit}).`,
      details: { resource, limit, used: limit },
    });
  });

  it("freeing one active item frees the slot", async () => {
    await fillTo(resource, limit);
    expect((await a.add()).status).toBe(403);

    expect((await a.free()).status).toBe(200);

    expect((await a.add()).status).toBe(201);
  });
});

describe.each(["WAREHOUSE", "PRODUCT"])("a restore of an archived %s is counted like a new one", (resource) => {
  const a = adapters[resource];
  beforeEach(() => setup("Starter"));

  it("is refused at the limit and works when there is room", async () => {
    const limit = PLANS.Starter[resource];
    await a.fillOff(1);
    await fillTo(resource, limit);

    const refused = await a.restore();
    expect(refused.status).toBe(403);
    expect(refused.body.details).toEqual({ resource, limit, used: limit });

    await a.free();
    expect((await a.restore()).status).toBe(200);
  });
});

describe("an inactive member who is invited and accepts again is counted like a new member", () => {
  beforeEach(() => setup("Starter"));

  it("is refused at the limit and works when there is room", async () => {
    const a = adapters.MEMBER;
    await a.fillOff(1);
    const { email } = await a.restore();
    const token = (await asOwner(request(app).post("/api/invitations")).send({ email, role: "VIEWER" })).body.token;
    expect(token).toEqual(expect.any(String));
    await fillTo("MEMBER", PLANS.Starter.MEMBER);
    const accept = () => request(app).post("/api/auth/accept-invite").send({ token, name: "Kembali", password: "Gula-Kopi-2026" });

    const refused = await accept();
    expect(refused.status).toBe(403);
    expect(refused.body.details).toEqual({ resource: "MEMBER", limit: 3, used: 3 });

    await a.free();
    expect((await accept()).status).toBe(200);
    expect((await sql(`SELECT "isActive" FROM "Users" WHERE "email" = :email`, { email }))[0].isActive).toBe(true);
  });
});

describe("a trial organization is held to the Starter limits and Business has other limits", () => {
  it("a trial (Starter subscription, status TRIAL) stops at 2 warehouses", async () => {
    await setup("Starter");
    await sql(`UPDATE "Organizations" SET "status" = 'TRIAL' WHERE "id" = :org`, { org });
    await fillTo("WAREHOUSE", 2);

    expect((await adapters.WAREHOUSE.add()).status).toBe(403);
  });

  it.each(resources)("the %s limit of Business is not the Starter limit", async (resource) => {
    await setup("Business");
    await fillTo(resource, PLANS.Starter[resource]);

    expect((await adapters[resource].add()).status).toBe(201);
  });

  it("an organization is judged by its own plan, whatever plan another organization has", async () => {
    await setup("Starter");
    const other = await createOrganization("tokob");
    const [business] = await sql(`SELECT id FROM "Plans" WHERE "name" = 'Business'`);
    await createSubscription(other, business.id);
    await fillTo("WAREHOUSE", 2);
    await sql(
      `INSERT INTO "Warehouses" ("organizationId","code","name") SELECT :other, 'B' || g, 'Isi' FROM generate_series(1, 5) g`,
      { other },
    );

    expect((await adapters.WAREHOUSE.add()).status).toBe(403);
  });
});
