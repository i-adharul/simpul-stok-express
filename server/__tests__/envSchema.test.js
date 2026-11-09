const { parseEnv } = require("../config/envSchema");

const valid = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgres://user@localhost:5432/simpul_dev",
  TEST_DATABASE_URL: "postgres://user@localhost:5432/simpul_test",
  JWT_SECRET: "x".repeat(32),
  JWT_EXPIRES_IN: "8h",
  CORS_ORIGIN: "http://localhost:5173",
};

describe("parseEnv", () => {
  it("returns typed values for a valid environment", () => {
    const env = parseEnv(valid);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.CORS_ORIGIN).toEqual(["http://localhost:5173"]);
  });

  it("splits CORS_ORIGIN on commas and trims spaces", () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGIN: "http://localhost:5173, https://app.example.com",
    });

    expect(env.CORS_ORIGIN).toEqual([
      "http://localhost:5173",
      "https://app.example.com",
    ]);
  });

  const required = Object.keys(valid).filter((key) => key !== "TEST_DATABASE_URL");

  it.each(required)("throws when %s is missing", (key) => {
    const source = { ...valid };
    delete source[key];

    expect(() => parseEnv(source)).toThrow(key);
  });

  it("rejects a JWT_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "x".repeat(31) })).toThrow(
      "JWT_SECRET",
    );
  });

  it("rejects a wildcard CORS_ORIGIN", () => {
    expect(() => parseEnv({ ...valid, CORS_ORIGIN: "*" })).toThrow(
      "CORS_ORIGIN",
    );
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: "staging" })).toThrow(
      "NODE_ENV",
    );
  });

  it.each(["abc", "0", "70000", "3000.5"])("rejects PORT %s", (port) => {
    expect(() => parseEnv({ ...valid, PORT: port })).toThrow("PORT");
  });

  it("rejects a database URL that is not postgres", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: "mysql://u@localhost/db" }),
    ).toThrow("DATABASE_URL");
  });

  it("does not put secret values in the error message", () => {
    const secret = "short-secret-value";

    expect(() => parseEnv({ ...valid, JWT_SECRET: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secret),
      }),
    );
  });

  describe("SEED_ALLOW_REMOTE", () => {
    it("is false when it is not set", () => {
      expect(parseEnv(valid).SEED_ALLOW_REMOTE).toBe(false);
    });

    it.each([
      ["true", true],
      ["false", false],
    ])("turns %s into a boolean", (value, expected) => {
      expect(
        parseEnv({ ...valid, SEED_ALLOW_REMOTE: value }).SEED_ALLOW_REMOTE,
      ).toBe(expected);
    });

    it.each(["yes", "1", "TRUE"])("rejects %s", (value) => {
      expect(() => parseEnv({ ...valid, SEED_ALLOW_REMOTE: value })).toThrow(
        "SEED_ALLOW_REMOTE",
      );
    });
  });
});

describe("COMMIT_SHA", () => {
  it("is null when it is not set or empty", () => {
    expect(parseEnv(valid).COMMIT_SHA).toBeNull();
    expect(parseEnv({ ...valid, COMMIT_SHA: "" }).COMMIT_SHA).toBeNull();
  });

  it("keeps the value when it is set", () => {
    expect(parseEnv({ ...valid, COMMIT_SHA: "abc1234" }).COMMIT_SHA).toBe(
      "abc1234",
    );
  });
});

describe("parseEnv: production deploy variables", () => {
  const production = {
    ...valid,
    NODE_ENV: "production",
    DATABASE_CA_PATH: "/home/ubuntu/certs/prod-ca-2021.crt",
  };
  delete production.TEST_DATABASE_URL;

  it("does not need TEST_DATABASE_URL outside the test environment", () => {
    expect(() => parseEnv(production)).not.toThrow();
    const { TEST_DATABASE_URL, ...development } = valid;
    expect(() => parseEnv(development)).not.toThrow();
  });

  it("needs TEST_DATABASE_URL when NODE_ENV is test", () => {
    const { TEST_DATABASE_URL, ...rest } = valid;

    expect(() => parseEnv({ ...rest, NODE_ENV: "test" })).toThrow(
      "TEST_DATABASE_URL",
    );
  });

  it("needs DATABASE_CA_PATH in production, so the certificate is always verified", () => {
    const { DATABASE_CA_PATH, ...rest } = production;

    expect(() => parseEnv(rest)).toThrow("DATABASE_CA_PATH");
  });

  it("does not need DATABASE_CA_PATH outside production", () => {
    expect(parseEnv(valid).DATABASE_CA_PATH).toBeNull();
  });

  it("reads SEED_PASSWORD as optional and keeps it out of error messages", () => {
    expect(parseEnv(valid).SEED_PASSWORD).toBeNull();
    expect(parseEnv({ ...valid, SEED_PASSWORD: "Abc12345xyz" }).SEED_PASSWORD).toBe(
      "Abc12345xyz",
    );
  });
});
