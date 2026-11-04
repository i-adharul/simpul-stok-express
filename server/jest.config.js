module.exports = {
  testEnvironment: "node",
  // Only *.test.js files are tests; the helpers in __tests__/support are not.
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/__tests__/support/setup.js"],
};
