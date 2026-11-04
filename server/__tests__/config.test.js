describe("config/config.js (sequelize-cli)", () => {
  let config;

  beforeAll(() => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      PORT: "3000",
      DATABASE_URL: "postgres://u@localhost:5432/simpul_dev",
      TEST_DATABASE_URL: "postgres://u@localhost:5432/simpul_test",
      JWT_SECRET: "x".repeat(32),
      JWT_EXPIRES_IN: "8h",
      CORS_ORIGIN: "http://localhost:5173",
    });
    config = require("../config/config");
  });

  it("defines development, test and production", () => {
    expect(Object.keys(config).sort()).toEqual([
      "development",
      "production",
      "test",
    ]);
  });

  it("points test at the test database, never the development one", () => {
    expect(config.test.url).toMatch(/simpul_test$/);
    expect(config.development.url).toMatch(/simpul_dev$/);
  });

  it("turns SSL on for production only", () => {
    expect(config.production.dialectOptions.ssl).toBeTruthy();
    expect(config.development.dialectOptions?.ssl).toBeUndefined();
    expect(config.test.dialectOptions?.ssl).toBeUndefined();
  });

  it("uses postgres everywhere", () => {
    for (const name of Object.keys(config)) {
      expect(config[name].dialect).toBe("postgres");
    }
  });
});
