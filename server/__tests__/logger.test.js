const { createLogger, redact } = require("../helpers/logger");

const capture = () => {
  const lines = [];
  return { lines, logger: createLogger({ write: (line) => lines.push(line) }) };
};

describe("logger", () => {
  it("writes exactly one line of JSON per call", () => {
    const { lines, logger } = capture();
    logger.info("hello", { a: 1 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "info",
      message: "hello",
      a: 1,
    });
  });

  it("adds an ISO time in UTC", () => {
    const { lines, logger } = capture();
    logger.info("x");

    expect(JSON.parse(lines[0]).time).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it.each(["info", "warn", "error"])("has the level %s", (level) => {
    const { lines, logger } = capture();
    logger[level]("x");

    expect(JSON.parse(lines[0]).level).toBe(level);
  });

  it("keeps a message with a line break on one line", () => {
    const { lines, logger } = capture();
    logger.info("first\nsecond");

    expect(lines).toHaveLength(1);
    expect(lines[0].split("\n")).toHaveLength(1);
    expect(JSON.parse(lines[0]).message).toBe("first\nsecond");
  });

  it("does not let a field overwrite time, level or message", () => {
    const { lines, logger } = capture();
    logger.warn("real", { level: "fake", message: "fake", time: "fake" });
    const entry = JSON.parse(lines[0]);

    expect(entry).toMatchObject({ level: "warn", message: "real" });
    expect(entry.time).not.toBe("fake");
  });

  it("prints nothing when silent", () => {
    const lines = [];
    createLogger({ write: (line) => lines.push(line), silent: true }).error(
      "x",
    );

    expect(lines).toEqual([]);
  });
});

describe("redaction", () => {
  it.each(["password", "Authorization", "token", "TOKEN"])(
    "hides the field %s",
    (key) => {
      const { lines, logger } = capture();
      logger.info("login", { [key]: "super-secret" });

      expect(lines[0]).not.toContain("super-secret");
      expect(JSON.parse(lines[0])[key]).toBe("[REDACTED]");
    },
  );

  it.each([
    "passwordHash",
    "accessToken",
    "resetTokenHash",
    "authorizationHeader",
  ])("hides the field %s that contains a secret word", (key) => {
    expect(redact({ [key]: "x" })[key]).toBe("[REDACTED]");
  });

  it("hides secrets in nested objects and arrays", () => {
    const copy = redact({
      user: { password: "p", name: "Budi" },
      list: [{ token: "t" }],
    });

    expect(copy).toEqual({
      user: { password: "[REDACTED]", name: "Budi" },
      list: [{ token: "[REDACTED]" }],
    });
  });

  it("keeps ordinary fields and does not change the original object", () => {
    const original = { name: "Budi", password: "p" };
    const copy = redact(original);

    expect(copy.name).toBe("Budi");
    expect(original.password).toBe("p");
  });

  it("does not crash on a circular object", () => {
    const loop = { name: "x" };
    loop.self = loop;
    const { lines, logger } = capture();

    expect(() => logger.info("loop", { loop })).not.toThrow();
    expect(JSON.parse(lines[0]).loop.self).toBe("[Circular]");
  });

  it("logs an error as name and message only, without the stack", () => {
    const { lines, logger } = capture();
    logger.error("failed", { error: new TypeError("boom") });
    const entry = JSON.parse(lines[0]);

    expect(entry.error).toEqual({ name: "TypeError", message: "boom" });
    expect(lines[0]).not.toContain("at ");
  });

  it("passes numbers, booleans and null through", () => {
    expect(redact({ a: 1, b: true, c: null })).toEqual({
      a: 1,
      b: true,
      c: null,
    });
  });
});
