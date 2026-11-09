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

  it("verifies the server certificate in production with the CA file from DATABASE_CA_PATH", () => {
    const os = require("os");
    const fs = require("fs");
    const path = require("path");
    const caFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "ca-")),
      "ca.crt",
    );
    fs.writeFileSync(caFile, "FAKE CA CONTENT");
    process.env.DATABASE_CA_PATH = caFile;

    let production;
    jest.isolateModules(() => {
      production = require("../config/config").production;
    });
    delete process.env.DATABASE_CA_PATH;

    expect(production.dialectOptions.ssl.rejectUnauthorized).toBe(true);
    expect(production.dialectOptions.ssl.ca).toBe("FAKE CA CONTENT");
  });

  it("never turns certificate verification off", () => {
    expect(config.production.dialectOptions.ssl.rejectUnauthorized).not.toBe(
      false,
    );
  });
});
