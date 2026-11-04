// Runs before every test file (setupFilesAfterEnv in jest.config.js).
const env = require("../../config/env");
const { assertTestDatabase } = require("./testDatabase");
const { closeDatabase } = require("./db");

// Fails the suite before any test can run, so nothing reaches the wrong database.
assertTestDatabase(env.TEST_DATABASE_URL);

afterAll(async () => {
  await closeDatabase();
});
