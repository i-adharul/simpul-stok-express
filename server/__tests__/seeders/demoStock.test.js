const bcrypt = require("bcryptjs");
const { Sequelize } = require("sequelize");
const { getSequelize } = require("../support/db");
const { clearTables } = require("../support/clearTables");
const plans = require("../../seeders/20261105000100-plans");
const baseAccounts = require("../../seeders/20261105000200-base-accounts");
const demoStock = require("../../seeders/20261108000300-demo-stock");
const { wibDayRange } = require("../../helpers/wibDay");

const NOW = new Date("2026-11-08T05:00:00Z");
const query = async (sql, replacements) => (await getSequelize().query(sql, { replacements }))[0];
const qi = () => getSequelize().getQueryInterface();
const seed = async (now = NOW) => {
  await plans.up(qi());
  await baseAccounts.up(qi());
  await demoStock.seedDemo(qi(), now);
};

describe("demo stock seeder", () => {
  jest.setTimeout(60000);

  beforeEach(() => clearTables(getSequelize()));
  afterAll(() => clearTables(getSequelize()));

  it("fills the demo organization with 3 warehouses, 50 products, stock and history", async () => {
    await seed();

    expect(await query(`SELECT code FROM "Warehouses" ORDER BY code`)).toHaveLength(3);
    expect(Number((await query(`SELECT count(*) AS n FROM "Products" WHERE "archivedAt" IS NULL`))[0].n)).toBe(50);
    expect(Number((await query(`SELECT count(*) AS n FROM "StockLevels"`))[0].n)).toBeGreaterThan(50);
    expect(Number((await query(`SELECT count(*) AS n FROM "StockMovements"`))[0].n)).toBeGreaterThan(150);
    expect(Number((await query(`SELECT count(*) AS n FROM "StockTransfers"`))[0].n)).toBeGreaterThanOrEqual(5);
  });

  it("puts every row in the organization of the base seed", async () => {
    await seed();
    const [{ id }] = await query(`SELECT id FROM "Organizations" WHERE slug = 'tokomaju'`);

    for (const table of ["Warehouses", "Products", "StockLevels", "StockMovements", "StockTransfers", "UserWarehouses"]) {
      const rows = await query(`SELECT DISTINCT "organizationId" FROM "${table}"`);
      expect(rows).toEqual([{ organizationId: id }]);
    }
  });

  it("keeps every stock level equal to the sum of its movements (the database CHECK is never needed)", async () => {
    await seed();

    const wrong = await query(
      `SELECT l."warehouseId", l."productId", l.quantity, COALESCE(SUM(m."quantityDelta"), 0) AS moved
       FROM "StockLevels" l
       LEFT JOIN "StockMovements" m ON m."warehouseId" = l."warehouseId" AND m."productId" = l."productId"
       GROUP BY l."warehouseId", l."productId", l.quantity
       HAVING l.quantity <> COALESCE(SUM(m."quantityDelta"), 0)`,
    );
    expect(wrong).toEqual([]);
    expect(await query(`SELECT 1 FROM "StockLevels" WHERE quantity < 0`)).toEqual([]);
  });

  it("links every transfer movement to a transfer of the same organization, two per item", async () => {
    await seed();

    const orphans = await query(
      `SELECT 1 FROM "StockMovements" m LEFT JOIN "StockTransfers" t ON t.id = m."transferId" AND t."organizationId" = m."organizationId"
       WHERE m."transferId" IS NOT NULL AND t.id IS NULL`,
    );
    expect(orphans).toEqual([]);
    const unbalanced = await query(
      `SELECT "transferId" FROM "StockMovements" WHERE "transferId" IS NOT NULL GROUP BY "transferId" HAVING SUM("quantityDelta") <> 0`,
    );
    expect(unbalanced).toEqual([]);
  });

  it("assigns the Warehouse Admin to two warehouses and the Viewer to one, and records real users as authors", async () => {
    await seed();

    const assigned = await query(
      `SELECT u.role, count(*) AS n FROM "UserWarehouses" uw JOIN "Users" u ON u.id = uw."userId" GROUP BY u.role ORDER BY u.role`,
    );
    expect(assigned.map((r) => [r.role, Number(r.n)]).sort()).toEqual([["VIEWER", 1], ["WAREHOUSE_ADMIN", 2]]);
    const authors = await query(`SELECT DISTINCT u.role FROM "StockMovements" m JOIN "Users" u ON u.id = m."createdById" ORDER BY u.role`);
    expect(authors.map((a) => a.role).sort()).toEqual(["OWNER", "WAREHOUSE_ADMIN"]);
    expect(await query(`SELECT 1 FROM "StockMovements" WHERE "createdById" IS NULL`)).toEqual([]);
  });

  it("has movements on the WIB day of the given instant, none in its future", async () => {
    await seed();
    const { from, to } = wibDayRange(NOW);

    const today = await query(`SELECT count(*) AS n FROM "StockMovements" WHERE "createdAt" >= :from AND "createdAt" < :to`, { from, to });
    expect(Number(today[0].n)).toBeGreaterThanOrEqual(3);
    expect(await query(`SELECT 1 FROM "StockMovements" WHERE "createdAt" > :now`, { now: NOW })).toEqual([]);
  });

  it("moves the organization to the Business plan, so 3 warehouses are within its limits", async () => {
    await seed();

    const [row] = await query(`SELECT p.name, p."maxWarehouses", p."maxProducts" FROM "Subscriptions" s JOIN "Plans" p ON p.id = s."planId" JOIN "Organizations" o ON o.id = s."organizationId" WHERE o.slug = 'tokomaju'`);
    expect(row.name).toBe("Business");
    expect(row.maxWarehouses).toBeGreaterThanOrEqual(3);
    expect(row.maxProducts).toBeGreaterThanOrEqual(50);
  });

  it("can run twice without adding anything", async () => {
    await seed();
    const count = async (table) => Number((await query(`SELECT count(*) AS n FROM "${table}"`))[0].n);
    const tables = ["Warehouses", "Products", "StockLevels", "StockMovements", "StockTransfers", "UserWarehouses"];
    const before = await Promise.all(tables.map(count));

    await demoStock.seedDemo(qi(), NOW);

    expect(await Promise.all(tables.map(count))).toEqual(before);
  });

  it("stops with a clear message when the base seed has not run", async () => {
    await plans.up(qi());
    await expect(demoStock.seedDemo(qi(), NOW)).rejects.toThrow(/base accounts seeder/);
  });

  it("leaves the demo logins working (the base accounts are untouched)", async () => {
    await seed();
    const [owner] = await query(`SELECT "passwordHash" FROM "Users" WHERE email = 'owner@example.com'`);
    expect(await bcrypt.compare("Simpul-Demo-2026", owner.passwordHash)).toBe(true);
  });

  it("refuses a remote database before writing anything", async () => {
    await plans.up(qi());
    await baseAccounts.up(qi());
    const remote = new Sequelize("postgres://admin:fake-pass@db.fake-project.supabase.co:5432/postgres", { dialect: "postgres", logging: false });

    await expect(demoStock.up(remote.getQueryInterface())).rejects.toThrow(/Refusing to seed/);
    expect(await query(`SELECT 1 FROM "Warehouses"`)).toEqual([]);
  });
});
