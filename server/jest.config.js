module.exports = {
  testEnvironment: "node",
  // Only *.test.js files are tests; the helpers in __tests__/support are not.
  testMatch: ["**/__tests__/**/*.test.js"],
  // Migrates the test database once before all tests.
  globalSetup: "<rootDir>/__tests__/support/globalSetup.js",
  setupFilesAfterEnv: ["<rootDir>/__tests__/support/setup.js"],
};
