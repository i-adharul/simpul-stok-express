// Restores the demo data: npm run demo:reset (from server/). Uses the database the environment
// points at (NODE_ENV picks it, like the app), and the seed guard refuses a remote host unless
// SEED_ALLOW_REMOTE=true. All the rules live in helpers/demoReset.js; this file only runs it.
const db = require("../models");
const { resetDemo } = require("../helpers/demoReset");

async function main() {
  await resetDemo(db.sequelize);
  // Only the host is printed: the connection URL holds the password.
  // eslint-disable-next-line no-console
  console.log(`Demo reset on host "${db.sequelize.config.host}": 3 warehouses, 50 products and the demo accounts restored.`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`Demo reset failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.sequelize.close());
