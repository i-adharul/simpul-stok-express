const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { runConcurrently } = require("./support/concurrency");
const { createOrganization, createPlan, createSubscription } = require("./support/factories");

jest.setTimeout(240000);

// BL20 under concurrency: with ONE slot left, 10 simultaneous creates give exactly one 201 and nine
// 403 PLAN_LIMIT_REACHED, for warehouses, products and invitations. The organization lock
// (planLimitService.lockOrganization) is what makes this true: without it every request counts "one
// slot left" and writes. Each scenario runs ROUNDS times in a row, because a race that fails one run
// in twenty must still be caught. To see the test fail, make lockOrganization return at once.
const ROUNDS = 20;
const REQUESTS = 10;

let org;
let owner;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const asOwner = (req) => req.set("Authorization", `Bearer ${signToken(owner.id)}`);
const unique = () => Math.random().toString(36).slice(2, 12);

beforeAll(async () => {
  await clearTables(getSequelize());
  const starter = await createPlan("Starter");
  org = await createOrganization("tokoa");
  await createSubscription(org, starter);
  owner = await createAccount({ email: "owner@example.com", role: "OWNER", organizationId: org });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

// Each scenario: `reset()` leaves exactly one slot free, `send()` is one create request, `count()` how
// many rows the creates produced.
const scenarios = {
  warehouses: {
    reset: async () => {
      await sql(`DELETE FROM "Warehouses" WHERE "organizationId" = :org`, { org });
      await sql(`INSERT INTO "Warehouses" ("organizationId","code","name") VALUES (:org,'KEEP-1','Isi')`, { org }); // limit 2: one slot left
    },
    send: () => asOwner(request(app).post("/api/warehouses")).send({ code: `N-${unique()}`.toUpperCase(), name: "Baru" }),
    count: async () => Number((await sql(`SELECT count(*) AS n FROM "Warehouses" WHERE "organizationId" = :org AND "archivedAt" IS NULL`, { org }))[0].n),
    final: 2,
  },
  products: {
    reset: async () => {
      await sql(`DELETE FROM "Products" WHERE "organizationId" = :org`, { org });
      await sql(
        `INSERT INTO "Products" ("organizationId","sku","name","unit") SELECT :org, 'KEEP-' || g, 'Isi', 'pcs' FROM generate_series(1, 99) g`,
        { org },
      ); // limit 100: one slot left
    },
    send: () => asOwner(request(app).post("/api/products")).send({ sku: `N-${unique()}`.toUpperCase(), name: "Baru", unit: "pcs" }),
    count: async () => Number((await sql(`SELECT count(*) AS n FROM "Products" WHERE "organizationId" = :org AND "archivedAt" IS NULL`, { org }))[0].n),
    final: 100,
  },
  invitations: {
    reset: async () => {
      await sql(`DELETE FROM "Invitations" WHERE "organizationId" = :org`, { org });
      await sql(`DELETE FROM "Users" WHERE "organizationId" = :org AND "role" <> 'OWNER'`, { org });
      await sql(
        `INSERT INTO "Users" ("organizationId","email","name","passwordHash","role") VALUES (:org,'keep@x.test','Isi','hash','VIEWER')`,
        { org },
      ); // the Owner and one more = 2 of 3: one slot left
    },
    // An invitation does not use a slot by itself, so ten DIFFERENT emails would all be 201. What the limit
    // serializes is the ACCEPTANCE: ten invitations are accepted at once, only one fits.
    send: null,
    final: 3,
  },
};

describe.each(["warehouses", "products"])("10 simultaneous creates of %s with one slot left", (name) => {
  const s = scenarios[name];

  it(`give exactly one 201 and nine 403, ${ROUNDS} times in a row`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await s.reset();

      const results = await runConcurrently(REQUESTS, () => s.send());

      const statuses = results.map((res) => res.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 403)).toHaveLength(REQUESTS - 1);
      for (const res of results.filter((r) => r.status === 403)) expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
      expect(await s.count()).toBe(s.final);
    }
  });
});

describe("10 simultaneous acceptances of invitations with one member slot left", () => {
  const s = scenarios.invitations;

  async function invitationsFor(n) {
    const tokens = [];
    for (let i = 0; i < n; i += 1) {
      const res = await asOwner(request(app).post("/api/invitations")).send({ email: `inv${i}-${unique()}@example.com`, role: "VIEWER" });
      expect(res.status).toBe(201); // pending invitations are not counted, so all ten are created
      tokens.push(res.body.token);
    }
    return tokens;
  }

  it(`give exactly one 200 and nine 403, ${ROUNDS} times in a row`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await s.reset();
      const tokens = await invitationsFor(REQUESTS);

      const results = await runConcurrently(REQUESTS, (i) =>
        request(app).post("/api/auth/accept-invite").send({ token: tokens[i], name: "Orang Baru", password: "Gula-Kopi-2026" }),
      );

      const statuses = results.map((res) => res.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 403)).toHaveLength(REQUESTS - 1);
      for (const res of results.filter((r) => r.status === 403)) expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
      const [{ n }] = await sql(`SELECT count(*) AS n FROM "Users" WHERE "organizationId" = :org AND "isActive"`, { org });
      expect(Number(n)).toBe(s.final);
    }
  });

  it(`10 simultaneous INVITATIONS with the same email give one 201 and nine 409 (the lock serializes the pending check)`, async () => {
    await s.reset();
    const email = `same-${unique()}@example.com`;

    const results = await runConcurrently(REQUESTS, () => asOwner(request(app).post("/api/invitations")).send({ email, role: "VIEWER" }));

    const statuses = results.map((res) => res.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(REQUESTS - 1);
    expect(await sql(`SELECT 1 FROM "Invitations" WHERE "email" = :email`, { email })).toHaveLength(1);
  });

  it(`10 simultaneous invitations at the limit give ten 403 and write nothing`, async () => {
    await s.reset();
    await sql(
      `INSERT INTO "Users" ("organizationId","email","name","passwordHash","role") VALUES (:org,'full@x.test','Isi','hash','VIEWER')`,
      { org },
    ); // now 3 of 3

    const results = await runConcurrently(REQUESTS, (i) =>
      asOwner(request(app).post("/api/invitations")).send({ email: `late${i}-${unique()}@example.com`, role: "VIEWER" }),
    );

    expect(results.map((res) => res.status)).toEqual(Array(REQUESTS).fill(403));
    expect(await sql(`SELECT 1 FROM "Invitations" WHERE "organizationId" = :org`, { org })).toHaveLength(0);
  });
});
