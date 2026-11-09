const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, createPlan, createSubscription } = require("./support/factories");

jest.setTimeout(60000);

// BL20 on every endpoint that adds a warehouse, a product or a member. Each test starts with an
// organization on Starter (2 warehouses, 100 products, 3 members) or Business (10, 500, 10).
let org;
let owner;
let plans;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const auth = () => `Bearer ${signToken(owner.id)}`;
const asOwner = (req) => req.set("Authorization", auth());
const count = async (table, where = "TRUE") =>
  Number((await sql(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = :org AND ${where}`, { org }))[0].n);

const warehouse = (code) => asOwner(request(app).post("/api/warehouses")).send({ code, name: `Gudang ${code}` });
const product = (sku) => asOwner(request(app).post("/api/products")).send({ sku, name: `Produk ${sku}`, unit: "pcs" });
const patchWarehouse = (id, body) => asOwner(request(app).patch(`/api/warehouses/${id}`)).send(body);
const patchProduct = (id, body) => asOwner(request(app).patch(`/api/products/${id}`)).send(body);
const invite = (email) => asOwner(request(app).post("/api/invitations")).send({ email, role: "VIEWER" });
const accept = (token) => request(app).post("/api/auth/accept-invite").send({ token, name: "Orang Baru", password: "Gula-Kopi-2026" });
const members = () => asOwner(request(app).get("/api/members"));

const fillWarehouses = (n, archived = false) =>
  sql(
    `INSERT INTO "Warehouses" ("organizationId","code","name","archivedAt")
     SELECT :org, upper('F' || substr(md5(random()::text || g::text), 1, 12)), 'Isi', CASE WHEN :archived THEN now() ELSE NULL END FROM generate_series(1, :n) g`,
    { org, n, archived },
  );
const fillProducts = (n, archived = false) =>
  sql(
    `INSERT INTO "Products" ("organizationId","sku","name","unit","archivedAt")
     SELECT :org, upper('F' || substr(md5(random()::text || g::text), 1, 12)), 'Isi', 'pcs', CASE WHEN :archived THEN now() ELSE NULL END FROM generate_series(1, :n) g`,
    { org, n, archived },
  );
const fillMembers = async (n) => {
  const made = [];
  for (let i = 0; i < n; i += 1) made.push(await createAccount({ email: `isi${i}-${Math.random().toString(36).slice(2, 8)}@example.com`, role: "VIEWER", organizationId: org }));
  return made;
};

async function setup(planName) {
  await clearTables(getSequelize());
  plans = { Starter: await createPlan("Starter"), Business: await createPlan("Business", { maxWarehouses: 10, maxProducts: 500, maxMembers: 10 }) };
  org = await createOrganization("tokoa");
  await createSubscription(org, plans[planName]);
  owner = await createAccount({ email: "owner@example.com", role: "OWNER", organizationId: org });
}
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const LIMIT = (resource, limit, used) => ({
  code: "PLAN_LIMIT_REACHED",
  message: expect.stringMatching(/^Batas (gudang|produk|anggota) pada paket Anda sudah tercapai \(\d+ dari \d+\)\.$/),
  details: { resource, limit, used },
});

describe("warehouses on Starter (limit 2)", () => {
  beforeEach(() => setup("Starter"));

  it("creates up to the limit and refuses the next one with 403 PLAN_LIMIT_REACHED, writing nothing", async () => {
    expect((await warehouse("GD-1")).status).toBe(201);
    expect((await warehouse("GD-2")).status).toBe(201);

    const res = await warehouse("GD-3");

    expect(res.status).toBe(403);
    expect(res.body).toEqual(LIMIT("WAREHOUSE", 2, 2));
    expect(res.body.message).toBe("Batas gudang pada paket Anda sudah tercapai (2 dari 2).");
    expect(await count("Warehouses")).toBe(2);
  });

  it("an archive frees a slot", async () => {
    const first = (await warehouse("GD-1")).body;
    await warehouse("GD-2");
    expect((await warehouse("GD-3")).status).toBe(403);

    expect((await patchWarehouse(first.id, { archived: true })).status).toBe(200);

    expect((await warehouse("GD-3")).status).toBe(201);
  });

  it("a restore at the limit is refused and the warehouse stays archived; after another archive it works", async () => {
    await fillWarehouses(1, true);
    const [archived] = await sql(`SELECT id FROM "Warehouses" WHERE "organizationId" = :org`, { org });
    const a = (await warehouse("GD-1")).body;
    await warehouse("GD-2");

    const refused = await patchWarehouse(archived.id, { archived: false });

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual(LIMIT("WAREHOUSE", 2, 2));
    expect(await count("Warehouses", '"archivedAt" IS NOT NULL')).toBe(1);

    await patchWarehouse(a.id, { archived: true });
    expect((await patchWarehouse(archived.id, { archived: false })).status).toBe(200);
  });

  it("restoring a warehouse that is not archived, and editing at the limit, are not counted as additions", async () => {
    const a = (await warehouse("GD-1")).body;
    await warehouse("GD-2");

    expect((await patchWarehouse(a.id, { archived: false })).status).toBe(200);
    expect((await patchWarehouse(a.id, { name: "Nama Baru" })).status).toBe(200);
  });

  it("a duplicate code at the limit is still the limit error (checked before writing)", async () => {
    await warehouse("GD-1");
    await warehouse("GD-2");

    expect((await warehouse("GD-1")).status).toBe(403);
  });
});

describe("products on Starter (limit 100)", () => {
  beforeEach(() => setup("Starter"));

  it("refuses the 101st product with 403 and the exact details, and the 100th passes", async () => {
    await fillProducts(99);
    expect((await product("SKU-100")).status).toBe(201);

    const res = await product("SKU-101");

    expect(res.status).toBe(403);
    expect(res.body).toEqual(LIMIT("PRODUCT", 100, 100));
    expect(res.body.message).toBe("Batas produk pada paket Anda sudah tercapai (100 dari 100).");
    expect(await count("Products")).toBe(100);
  });

  it("archived products are not counted, an archive frees a slot, and a restore at the limit is refused", async () => {
    await fillProducts(5, true);
    await fillProducts(99);
    const created = (await product("SKU-100")).body;
    const [archived] = await sql(`SELECT id FROM "Products" WHERE "organizationId" = :org AND "archivedAt" IS NOT NULL LIMIT 1`, { org });

    const refused = await patchProduct(archived.id, { archived: false });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual(LIMIT("PRODUCT", 100, 100));

    await patchProduct(created.id, { archived: true });
    expect((await product("SKU-101")).status).toBe(201);
    expect((await patchProduct(archived.id, { archived: false })).status).toBe(403);
  });

  it("a product edit and a no-op restore at the limit pass", async () => {
    await fillProducts(99);
    const created = (await product("SKU-100")).body;

    expect((await patchProduct(created.id, { name: "Baru" })).status).toBe(200);
    expect((await patchProduct(created.id, { archived: false })).status).toBe(200);
  });
});

describe("members on Starter (limit 3: the Owner and two more)", () => {
  beforeEach(async () => {
    await setup("Starter");
    await fillMembers(1);
  });

  it("an invitation is allowed with one slot left and refused at the limit, with nothing written", async () => {
    expect((await invite("a@example.com")).status).toBe(201);
    await fillMembers(1);

    const res = await invite("b@example.com");

    expect(res.status).toBe(403);
    expect(res.body).toEqual(LIMIT("MEMBER", 3, 3));
    expect(res.body.message).toBe("Batas anggota pada paket Anda sudah tercapai (3 dari 3).");
    expect(await count("Invitations")).toBe(1);
  });

  it("pending invitations are not counted, but the limit is checked again on accept", async () => {
    const first = (await invite("a@example.com")).body.token;
    const second = (await invite("b@example.com")).body.token;
    expect(await count("Invitations")).toBe(2);

    const ok = await accept(first);
    const refused = await accept(second);

    expect(ok.status).toBe(200);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual(LIMIT("MEMBER", 3, 3));
    expect(await sql(`SELECT 1 FROM "Users" WHERE "email" = 'b@example.com'`)).toHaveLength(0);
    expect(await count("Invitations", '"acceptedAt" IS NULL')).toBe(1);
  });

  it("an inactive user frees a slot: after a deactivation the refused invitation can be accepted", async () => {
    const token = (await invite("a@example.com")).body.token; // the Owner and one more: a slot is free
    const [active] = await fillMembers(1); // now the organization is at its limit
    expect((await accept(token)).status).toBe(403);
    const [full] = await sql(`SELECT count(*)::int AS n FROM "Users" WHERE "organizationId" = :org AND "isActive"`, { org });
    expect(full.n).toBe(3);

    await asOwner(request(app).patch(`/api/members/${active.id}`)).send({ isActive: false });

    expect((await accept(token)).status).toBe(200);
  });

  it("an inactive member who accepts again is counted: refused at the limit, accepted with room", async () => {
    const [gone] = await fillMembers(1);
    await asOwner(request(app).patch(`/api/members/${gone.id}`)).send({ isActive: false });
    const token = (await invite(gone.email)).body.token; // owner + 1 active: one slot is free
    await fillMembers(1); // now the Owner and two active users: the organization is at its limit

    const refused = await accept(token);

    expect(refused.status).toBe(403);
    expect(refused.body).toEqual(LIMIT("MEMBER", 3, 3));
    const [row] = await sql(`SELECT "isActive" FROM "Users" WHERE "id" = :id`, { id: gone.id });
    expect(row.isActive).toBe(false);
  });

  it("GET /api/members shows the usage: active users against the limit, not the inactive ones", async () => {
    const [gone] = await fillMembers(1);
    await asOwner(request(app).patch(`/api/members/${gone.id}`)).send({ isActive: false });

    const res = await members();

    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual({ used: 2, limit: 3 });
    expect(res.body.total).toBe(3);
  });
});

describe("Business opens the higher limits", () => {
  beforeEach(() => setup("Business"));

  it("a third warehouse, the 101st product and a fourth member all pass", async () => {
    await fillWarehouses(2);
    await fillProducts(100);
    await fillMembers(2);

    expect((await warehouse("GD-3")).status).toBe(201);
    expect((await product("SKU-101")).status).toBe(201);
    expect((await invite("a@example.com")).status).toBe(201);
    expect((await members()).body.usage).toEqual({ used: 3, limit: 10 });
  });

  it("but the Business limits are limits too: 10 warehouses, 500 products, 10 members", async () => {
    await fillWarehouses(10);
    await fillProducts(500);
    await fillMembers(9);

    expect((await warehouse("GD-11")).body).toEqual(LIMIT("WAREHOUSE", 10, 10));
    expect((await product("SKU-501")).body).toEqual(LIMIT("PRODUCT", 500, 500));
    expect((await invite("a@example.com")).body).toEqual(LIMIT("MEMBER", 10, 10));
  });
});

describe("a trial organization", () => {
  it("is held to the Starter limits (its subscription points at Starter)", async () => {
    await setup("Starter");
    await sql(`UPDATE "Organizations" SET "status" = 'TRIAL' WHERE "id" = :org`, { org });
    await fillWarehouses(2);

    expect((await warehouse("GD-3")).body).toEqual(LIMIT("WAREHOUSE", 2, 2));
  });
});
