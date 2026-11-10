const bcrypt = require("bcryptjs");
const { getSequelize } = require("../support/db");
const { clearTables } = require("../support/clearTables");
const plans = require("../../seeders/20261105000100-plans");
const baseAccounts = require("../../seeders/20261105000200-base-accounts");

const PASSWORD = "Simpul-Demo-2026";

const query = async (sql) => (await getSequelize().query(sql))[0];
const seed = async () => {
  const queryInterface = getSequelize().getQueryInterface();
  await plans.up(queryInterface);
  await baseAccounts.up(queryInterface);
};

describe("base accounts seeder", () => {
  jest.setTimeout(30000);

  beforeEach(() => clearTables(getSequelize()));
  afterAll(() => clearTables(getSequelize()));

  it("creates the two demo organizations in their trial", async () => {
    await seed();
    const organizations = await query(
      'SELECT "slug", "name", "status" FROM "Organizations" ORDER BY "slug"',
    );

    expect(organizations).toEqual([
      { slug: "kopisenja", name: "Kopi Senja", status: "TRIAL" },
      { slug: "tokomaju", name: "Toko Maju", status: "TRIAL" },
    ]);
  });

  it("creates a 30-day Starter subscription with 3 days of grace and no billing day, for each organization", async () => {
    await seed();
    const subscriptions = await query(
      `SELECT p."name", s."billingDay",
              extract(epoch FROM s."currentPeriodEnd" - s."currentPeriodStart") / 86400 AS period_days,
              extract(epoch FROM s."graceUntil" - s."currentPeriodEnd") / 86400 AS grace_days
       FROM "Subscriptions" s JOIN "Plans" p ON p."id" = s."planId"`,
    );

    expect(subscriptions).toHaveLength(2);
    for (const subscription of subscriptions) {
      expect(subscription.name).toBe("Starter");
      expect(subscription.billingDay).toBeNull();
      expect(Number(subscription.period_days)).toBe(30);
      expect(Number(subscription.grace_days)).toBe(3);
    }
  });

  it("creates one user per role in each organization and one platform admin without an organization", async () => {
    await seed();
    const users = await query(
      'SELECT "role", "organizationId", "isActive" FROM "Users"',
    );

    expect(users.map((user) => user.role).sort()).toEqual([
      "OWNER",
      "OWNER",
      "PLATFORM_ADMIN",
      "VIEWER",
      "VIEWER",
      "WAREHOUSE_ADMIN",
      "WAREHOUSE_ADMIN",
    ]);
    expect(
      users.find((user) => user.role === "PLATFORM_ADMIN").organizationId,
    ).toBeNull();
    users
      .filter((user) => user.role !== "PLATFORM_ADMIN")
      .forEach((user) => expect(user.organizationId).not.toBeNull());
    expect(users.every((user) => user.isActive)).toBe(true);
  });

  it("puts each account in its own organization, with emails that differ", async () => {
    await seed();
    const rows = await query(
      `SELECT u."email", u."role", o."slug" FROM "Users" u LEFT JOIN "Organizations" o ON o."id" = u."organizationId" ORDER BY u."email"`,
    );

    expect(new Set(rows.map((row) => row.email)).size).toBe(7);
    for (const slug of ["tokomaju", "kopisenja"]) {
      expect(rows.filter((row) => row.slug === slug).map((row) => row.role).sort()).toEqual(["OWNER", "VIEWER", "WAREHOUSE_ADMIN"]);
    }
    expect(rows.filter((row) => row.slug === null)).toEqual([
      { email: "platform@example.com", role: "PLATFORM_ADMIN", slug: null },
    ]);
    expect(rows.find((row) => row.role === "OWNER" && row.slug === "kopisenja").email).toBe("owner@kopisenja.example.com");
  });

  it("stores bcrypt hashes with cost 12, never the password", async () => {
    await seed();
    const users = await query('SELECT "passwordHash" FROM "Users"');

    for (const user of users) {
      expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, user.passwordHash)).toBe(true);
    }
  });

  it("can run twice without duplicating anything", async () => {
    await seed();
    await seed();

    expect(await query('SELECT 1 FROM "Users"')).toHaveLength(7);
    expect(await query('SELECT 1 FROM "Organizations"')).toHaveLength(2);
    expect(await query('SELECT 1 FROM "Subscriptions"')).toHaveLength(2);
  });

  it("stops with a clear message when the plans are missing", async () => {
    await expect(
      baseAccounts.up(getSequelize().getQueryInterface()),
    ).rejects.toThrow(/Starter plan not found/);
  });

  it("removes what it created on down and keeps the plans", async () => {
    await seed();
    await baseAccounts.down(getSequelize().getQueryInterface());

    expect(await query('SELECT 1 FROM "Users"')).toHaveLength(0);
    expect(await query('SELECT 1 FROM "Organizations"')).toHaveLength(0);
    expect(await query('SELECT 1 FROM "Plans"')).toHaveLength(2);
  });
});
