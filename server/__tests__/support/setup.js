// Runs before every test file (setupFilesAfterEnv in jest.config.js).
// The suite must not depend on the developer's local .env. dotenv never overrides a variable that is
// already set, so pinning these first (before config/env.js loads) wins over a DEMO_* value in .env.
// A test that needs demo mode turns it on itself (it mocks config/env).
process.env.DEMO_MODE = "false";
for (const key of ["DEMO_OWNER_EMAIL", "DEMO_ADMIN_EMAIL", "DEMO_VIEWER_EMAIL"]) process.env[key] = "";

const env = require("../../config/env");
const { assertTestDatabase } = require("./testDatabase");
const { closeDatabase } = require("./db");

// Fails the suite before any test can run, so nothing reaches the wrong database.
assertTestDatabase(env.TEST_DATABASE_URL);

afterAll(async () => {
  await closeDatabase();
});
