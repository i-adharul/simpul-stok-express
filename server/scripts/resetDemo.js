// Restores the demo data: npm run demo:reset (from server/), or the cron wrapper on the host
// (scripts/resetDemoCron.sh). All the rules live in helpers/demoReset.js; this file only chooses the
// connection and runs it. The API server never runs it (ADR 0017).
//
// Connection: with DEMO_RESET_DATABASE_URL set (always, in production) the script opens its own
// connection with the reset role and never touches DATABASE_URL. Without it, locally, it uses the
// database that NODE_ENV picks, as before. The seed guard still refuses a remote host unless
// SEED_ALLOW_REMOTE=true.
const { Sequelize } = require("sequelize");
const env = require("../config/env");
const config = require("../config/config");
const { resetDemo } = require("../helpers/demoReset");
const { resolveResetConnection } = require("../helpers/resetConnection");

function openSequelize() {
  const { url: appUrl, ...options } = config[env.NODE_ENV];
  const resetUrl = resolveResetConnection({ nodeEnv: env.NODE_ENV, resetUrl: env.DEMO_RESET_DATABASE_URL, appUrl });
  // Same TLS options as the application (verified certificate in production), another URL and a tiny pool.
  if (resetUrl) return new Sequelize(resetUrl, { ...options, pool: { max: 2, min: 0, acquire: 10000, idle: 1000 } });
  return require("../models").sequelize;
}

async function main(sequelize) {
  const [[{ role }]] = await sequelize.query("SELECT current_user AS role");
  const { counts, wipedOrganizations } = await resetDemo(sequelize);
  // Only the host and the role name are printed: the connection URL holds the password. The numbers come from the rows.
  // eslint-disable-next-line no-console
  console.log(
    `Demo reset on host "${sequelize.config.host}" as role "${role}": ${counts.organizations} organizations, ` +
      `${counts.warehouses} warehouses and ${counts.products} products restored; ${wipedOrganizations} other organizations deleted.`,
  );
}

let sequelize;
Promise.resolve()
  .then(() => {
    sequelize = openSequelize();
    return main(sequelize);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Demo reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => sequelize?.close());
