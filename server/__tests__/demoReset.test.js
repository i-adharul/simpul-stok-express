const { Sequelize } = require("sequelize");
const bcrypt = require("bcryptjs");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");
const plans = require("../seeders/20261105000100-plans");
const baseAccounts = require("../seeders/20261105000200-base-accounts");
const demoStock = require("../seeders/20261108000300-demo-stock");
const { resetDemo } = require("../helpers/demoReset");

const NOW = new Date("2026-11-08T05:00:00Z");
const qi = () => getSequelize().getQueryInterface();
const query = async (sql, replacements) => (await getSequelize().query(sql, { replacements }))[0];
const count = async (table) => Number((await query(`SELECT count(*) AS n FROM "${table}"`))[0].n);

const seed = async () => {
  await plans.up(qi());
  await baseAccounts.up(qi());
  await demoStock.seedDemo(qi(), NOW);
};

// What a person sees of the demo, without the generated ids: it must come back identical.
async function fingerprint() {
  return {
    levels: await query(
      `SELECT w.code AS warehouse, p.sku, l.quantity FROM "StockLevels" l
       JOIN "Warehouses" w ON w.id = l."warehouseId" JOIN "Products" p ON p.id = l."productId" ORDER BY w.code, p.sku`,
    ),
    movements: await query(
      `SELECT w.code AS warehouse, p.sku, m.type, m."quantityDelta", m."createdAt" FROM "StockMovements" m
       JOIN "Warehouses" w ON w.id = m."warehouseId" JOIN "Products" p ON p.id = m."productId"
       ORDER BY m."createdAt", w.code, p.sku, m.type`,
    ),
    transfers: await query(`SELECT code, note FROM "StockTransfers" ORDER BY code`),
    users: await query(`SELECT email, role FROM "Users" ORDER BY email`),
  };
}

describe("demo reset", () => {
  jest.setTimeout(60000);

  beforeEach(() => clearTables(getSequelize()));
  afterAll(() => clearTables(getSequelize()));

  it("brings the demo back exactly as the seed made it, after the data was changed", async () => {
    await seed();
    const original = await fingerprint();
    const [{ id: organizationId }] = await query(`SELECT id FROM "Organizations" WHERE slug = 'tokomaju'`);
    // A visitor's changes: a new product and warehouse, a stock change, an extra movement.
    await query(`INSERT INTO "Products" ("organizationId", sku, name, unit) VALUES (:organizationId, 'JUNK-1', 'Junk', 'pcs')`, { organizationId });
    await query(`INSERT INTO "Warehouses" ("organizationId", code, name) VALUES (:organizationId, 'GD-JUNK', 'Junk')`, { organizationId });
    await query(`UPDATE "StockLevels" SET quantity = quantity + 5 WHERE id = (SELECT id FROM "StockLevels" LIMIT 1)`);
    await query(`INSERT INTO "IdempotencyKeys" ("organizationId", "key", endpoint) VALUES (:organizationId, gen_random_uuid(), 'POST /api/stock/receive')`, { organizationId });
    expect(await count("IdempotencyKeys")).toBe(1);

    const result = await resetDemo(getSequelize(), { now: NOW });

    expect(result).toEqual({ reset: true });
    expect(await fingerprint()).toEqual(original);
    expect(await query(`SELECT 1 FROM "Products" WHERE sku = 'JUNK-1'`)).toEqual([]);
    expect(await query(`SELECT 1 FROM "Warehouses" WHERE code = 'GD-JUNK'`)).toEqual([]);
    expect(await count("IdempotencyKeys")).toBe(0);
  });

  it("restores the demo logins, even when a password was changed", async () => {
    await seed();
    await query(`UPDATE "Users" SET "passwordHash" = 'changed' WHERE email = 'owner@example.com'`);

    await resetDemo(getSequelize(), { now: NOW });

    const [owner] = await query(`SELECT "passwordHash" FROM "Users" WHERE email = 'owner@example.com'`);
    expect(await bcrypt.compare("Simpul-Demo-2026", owner.passwordHash)).toBe(true);
  });

  it("works on an empty database too, and twice in a row", async () => {
    await plans.up(qi());

    await resetDemo(getSequelize(), { now: NOW });
    const first = await fingerprint();
    await resetDemo(getSequelize(), { now: NOW });

    expect(await fingerprint()).toEqual(first);
    expect(await count("Products")).toBe(50);
  });

  it("keeps the plans, including a price that was changed by hand", async () => {
    await seed();
    await query(`UPDATE "Plans" SET "priceIdr" = 123456 WHERE name = 'Business'`);

    await resetDemo(getSequelize(), { now: NOW });

    expect((await query(`SELECT "priceIdr" FROM "Plans" WHERE name = 'Business'`))[0].priceIdr).toBe(123456);
    expect(await count("Plans")).toBe(2);
  });

  it("refuses when another organization exists, and deletes nothing", async () => {
    await seed();
    await createOrganization("tokolain");
    const before = await count("StockMovements");
    const organizationsBefore = await count("Organizations");

    await expect(resetDemo(getSequelize(), { now: NOW })).rejects.toThrow(/organization other than the demo/);

    expect(await count("StockMovements")).toBe(before);
    expect(await count("Organizations")).toBe(organizationsBefore);
    expect(organizationsBefore).toBe(3);
  });

  it("refuses a remote database before touching anything", async () => {
    await seed();
    const remote = new Sequelize("postgres://admin:fake-pass@db.fake-project.supabase.co:5432/postgres", { dialect: "postgres", logging: false });
    const before = await count("StockMovements");

    await expect(resetDemo(remote, { now: NOW })).rejects.toThrow(/Refusing to seed/);

    expect(await count("StockMovements")).toBe(before);
    await remote.close();
  });
});
