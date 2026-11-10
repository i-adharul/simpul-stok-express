const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");
const { resetDemo } = require("../helpers/demoReset");

// The two demo organizations as a visitor meets them: after a real reset, through HTTP. The counts,
// the plan and the accounts are read from the rows; the isolation is read from the API.
jest.setTimeout(120000);

const PASSWORD = "Simpul-Demo-2026";
const NOW = new Date("2026-11-08T05:00:00Z");
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const login = async (email) => {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
};

beforeAll(async () => {
  await clearTables(getSequelize());
  await resetDemo(getSequelize(), { now: NOW });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("after a demo reset", () => {
  it("there are exactly two organizations, both on the Business plan", async () => {
    const rows = await sql(
      `SELECT o.slug, p.name AS plan FROM "Organizations" o JOIN "Subscriptions" s ON s."organizationId" = o.id JOIN "Plans" p ON p.id = s."planId" ORDER BY o.slug`,
    );
    expect(rows).toEqual([
      { slug: "kopisenja", plan: "Business" },
      { slug: "tokomaju", plan: "Business" },
    ]);
  });

  it("each has 3 warehouses, 50 products and stock history", async () => {
    const rows = await sql(
      `SELECT o.slug,
              (SELECT count(*) FROM "Warehouses" w WHERE w."organizationId" = o.id) AS warehouses,
              (SELECT count(*) FROM "Products" p WHERE p."organizationId" = o.id) AS products,
              (SELECT count(*) FROM "StockMovements" m WHERE m."organizationId" = o.id) AS movements
       FROM "Organizations" o ORDER BY o.slug`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Number(row.warehouses)).toBe(3);
      expect(Number(row.products)).toBe(50);
      expect(Number(row.movements)).toBeGreaterThan(150);
    }
  });

  it("each has one Owner, one Warehouse Admin and one Viewer, and there is one Platform admin", async () => {
    const rows = await sql(
      `SELECT o.slug, u.role, count(*) AS n FROM "Users" u LEFT JOIN "Organizations" o ON o.id = u."organizationId" GROUP BY o.slug, u.role ORDER BY o.slug, u.role`,
    );
    const seen = rows.map((r) => [r.slug, r.role, Number(r.n)]).sort();
    expect(seen).toEqual(
      [
        ["kopisenja", "OWNER", 1],
        ["kopisenja", "VIEWER", 1],
        ["kopisenja", "WAREHOUSE_ADMIN", 1],
        [null, "PLATFORM_ADMIN", 1],
        ["tokomaju", "OWNER", 1],
        ["tokomaju", "VIEWER", 1],
        ["tokomaju", "WAREHOUSE_ADMIN", 1],
      ].sort(),
    );
  });

  it("the Owner of the second organization can sign in and sees its own warehouses", async () => {
    const owner = await login("owner@kopisenja.example.com");
    const res = await request(app).get("/api/warehouses").query({ pageSize: 100 }).set(owner);

    expect(res.status).toBe(200);
    expect(res.body.items.map((w) => w.code).sort()).toEqual(["KS-BDG", "KS-DGO", "KS-LBG"]);
  });

  describe("an account of the first organization", () => {
    let owner;
    let foreignWarehouse;
    let foreignProduct;
    let foreignMovement;

    beforeAll(async () => {
      owner = await login("owner@example.com");
      [foreignWarehouse] = await sql(`SELECT w.id FROM "Warehouses" w JOIN "Organizations" o ON o.id = w."organizationId" WHERE o.slug = 'kopisenja' LIMIT 1`);
      [foreignProduct] = await sql(`SELECT p.id FROM "Products" p JOIN "Organizations" o ON o.id = p."organizationId" WHERE o.slug = 'kopisenja' LIMIT 1`);
      [foreignMovement] = await sql(`SELECT m.id FROM "StockMovements" m JOIN "Organizations" o ON o.id = m."organizationId" WHERE o.slug = 'kopisenja' LIMIT 1`);
    });

    it("lists only its own warehouses, products, stock and movements", async () => {
      const warehouses = await request(app).get("/api/warehouses").query({ pageSize: 100 }).set(owner);
      const products = await request(app).get("/api/products").query({ pageSize: 100 }).set(owner);
      const stock = await request(app).get("/api/stock").query({ pageSize: 100 }).set(owner);
      const movements = await request(app).get("/api/stock/movements").set(owner);

      expect(warehouses.body.items.map((w) => w.code).sort()).toEqual(["GD-BDG", "GD-JKT", "GD-SBY"]);
      expect(products.body.items).toHaveLength(50);
      for (const p of products.body.items) expect(p.sku).not.toMatch(/^(KPI|SSU|SRP|TEH|ROT|BHN|PKG)-/);
      expect(stock.body.items.length).toBeGreaterThan(0);
      for (const level of stock.body.items) expect(level.warehouse.code).toMatch(/^GD-/);
      expect(movements.body.items.length).toBeGreaterThan(0);
      const ownWarehouseIds = new Set(warehouses.body.items.map((w) => w.id));
      for (const m of movements.body.items) expect(ownWarehouseIds.has(m.warehouseId)).toBe(true);
    });

    it("gets 404, not 403, for the second organization's warehouse, product and movement", async () => {
      const warehouse = await request(app).get(`/api/warehouses/${foreignWarehouse.id}`).set(owner);
      const product = await request(app).get(`/api/products/${foreignProduct.id}`).set(owner);
      const movement = await request(app).get(`/api/stock/movements/${foreignMovement.id}`).set(owner);

      expect(warehouse.status).toBe(404);
      expect(product.status).toBe(404);
      expect(movement.status).toBe(404);
    });
  });

  it("a third organization makes the reset refuse, and the two demo organizations stay", async () => {
    await createOrganization("tokolain");

    await expect(resetDemo(getSequelize(), { now: NOW })).rejects.toThrow(/organization other than the demo/);

    expect(await sql(`SELECT slug FROM "Organizations" ORDER BY slug`)).toEqual([{ slug: "kopisenja" }, { slug: "tokolain" }, { slug: "tokomaju" }]);
    await sql(`DELETE FROM "Organizations" WHERE slug = 'tokolain'`);
  });
});
