const { assertSeedAllowed } = require("./seedGuard");
const plans = require("../seeders/20261105000100-plans");
const baseAccounts = require("../seeders/20261105000200-base-accounts");
const demoStock = require("../seeders/20261108000300-demo-stock");

// Puts the demo back as the seeds made it (S: "reset the demo"). Everything of the demo
// organization goes, and the three seeders run again, so a visitor's changes, new users and even a
// changed demo password are gone. The plans stay (a price changed by hand is not demo data).
//
// Why TRUNCATE and not DELETE: a stock movement cannot be deleted (append-only trigger, ADR 0005),
// so the only way to empty that table is TRUNCATE, which empties it for every organization. That is
// why this refuses to run when another organization exists: it is for a database that holds the
// demo and nothing else. One TRUNCATE statement names all tables, because Postgres refuses to
// empty a table that another table still references unless both go in the same statement.
const ORGANIZATION_SLUG = "tokomaju";
const TABLES = [
  "Notifications",
  "AuditLogs",
  "WebhookEvents",
  "Invoices",
  "Invitations",
  "IdempotencyKeys",
  "StockMovements",
  "ImportJobs",
  "StockTransfers",
  "StockLevels",
  "UserWarehouses",
  "Warehouses",
  "Products",
  "Subscriptions",
  "Users",
  "Organizations",
];

async function assertOnlyDemoOrganization(sequelize) {
  const [rows] = await sequelize.query(`SELECT 1 FROM "Organizations" WHERE "slug" <> :slug LIMIT 1`, { replacements: { slug: ORGANIZATION_SLUG } });
  if (rows.length > 0) {
    throw new Error("Refusing to reset: another organization exists, and TRUNCATE would delete its data too.");
  }
}

// `now` is the end of the restored history (the CLI passes the current time). The seed guard runs
// first, so a remote database is refused before anything is read or written. A failure after the
// TRUNCATE leaves an empty demo: run the reset again.
async function resetDemo(sequelize, { now = new Date() } = {}) {
  assertSeedAllowed(sequelize);
  await assertOnlyDemoOrganization(sequelize);

  await sequelize.query(`TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")}`);

  const queryInterface = sequelize.getQueryInterface();
  await plans.up(queryInterface);
  await baseAccounts.up(queryInterface);
  await demoStock.seedDemo(queryInterface, now);
  return { reset: true };
}

module.exports = { resetDemo, TABLES };
