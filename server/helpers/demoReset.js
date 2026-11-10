const env = require("../config/env");
const { assertSeedAllowed } = require("./seedGuard");
const plans = require("../seeders/20261105000100-plans");
const baseAccounts = require("../seeders/20261105000200-base-accounts");
const demoStock = require("../seeders/20261108000300-demo-stock");
const { DEMO_SLUGS } = require("./demoProfiles");

// Puts the demo back as the seeds made it (S: "reset the demo"). Everything of the demo
// organization goes, and the three seeders run again, so a visitor's changes, new users and even a
// changed demo password are gone. The plans stay (a price changed by hand is not demo data).
//
// Why TRUNCATE and not DELETE: a stock movement cannot be deleted (append-only trigger, ADR 0005),
// so the only way to empty that table is TRUNCATE, which empties it for every organization. That is
// why this refuses to run when an organization other than the two demo ones exists, unless the maintainer
// turned on the second switch (DEMO_RESET_WIPE_OTHERS, ADR 0017): it is for a database that holds the
// demo and nothing else, and the switch says that this one does. One TRUNCATE statement names all tables, because Postgres refuses to
// empty a table that another table still references unless both go in the same statement.
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

// How many organizations outside the demo ones exist. Without the switch any of them stops the reset
// before anything is deleted; with it they are counted, so the summary can say how many went.
async function countOtherOrganizations(sequelize, wipeOthers) {
  const [[row]] = await sequelize.query(`SELECT count(*) AS n FROM "Organizations" WHERE "slug" NOT IN (:slugs)`, { replacements: { slugs: DEMO_SLUGS } });
  const others = Number(row.n);
  if (others > 0 && wipeOthers !== true) {
    throw new Error(
      "Refusing to reset: an organization other than the demo ones exists, and TRUNCATE would delete its data too. " +
        "Set DEMO_RESET_WIPE_OTHERS=true only on a server whose database serves the demo and nothing else.",
    );
  }
  return others;
}

// What the database holds now, counted from the rows (never fixed text), so the script's summary is
// a real check: "2 organizations, 6 warehouses, 100 products" only if that is what is there.
async function countDemo(sequelize) {
  const [[row]] = await sequelize.query(
    `SELECT (SELECT count(*) FROM "Organizations") AS organizations,
            (SELECT count(*) FROM "Warehouses") AS warehouses,
            (SELECT count(*) FROM "Products") AS products`,
  );
  return { organizations: Number(row.organizations), warehouses: Number(row.warehouses), products: Number(row.products) };
}

// `now` is the end of the restored history (the CLI passes the current time). The seed guard runs
// first, so a remote database is refused before anything is read or written. A failure after the
// TRUNCATE leaves an empty demo: run the reset again.
async function resetDemo(sequelize, { now = new Date(), wipeOthers = env.DEMO_RESET_WIPE_OTHERS } = {}) {
  assertSeedAllowed(sequelize);
  const wipedOrganizations = await countOtherOrganizations(sequelize, wipeOthers);

  await sequelize.query(`TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")}`);

  const queryInterface = sequelize.getQueryInterface();
  await plans.up(queryInterface);
  await baseAccounts.up(queryInterface);
  await demoStock.seedDemo(queryInterface, now);
  return { reset: true, wipedOrganizations, counts: await countDemo(sequelize) };
}

module.exports = { resetDemo, countDemo, TABLES };
