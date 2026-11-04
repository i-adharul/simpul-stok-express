const { execFileSync } = require("child_process");
const env = require("../../config/env");
const { assertTestDatabase } = require("./testDatabase");

// Runs once before the whole suite, so the schema tests never see a stale or empty database.
module.exports = async function globalSetup() {
  // The per-file guard in setup.js runs later; check here too, because migrating is a write.
  assertTestDatabase(env.TEST_DATABASE_URL);

  execFileSync("npx", ["sequelize-cli", "db:migrate"], {
    cwd: __dirname + "/../..",
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "pipe",
  });
};
