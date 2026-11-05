const env = require("../config/env");

const LEVELS = ["info", "warn", "error"];
// A key is redacted when its name contains one of these words, in any letter case. That also
// covers passwordHash, accessToken or resetTokenHash (docs/05_Technical_Design.md, security).
const SECRET_WORDS = ["password", "authorization", "token"];
const REDACTED = "[REDACTED]";

const looksSecret = (key) =>
  SECRET_WORDS.some((word) => key.toLowerCase().includes(word));

// Returns a copy that is safe to print. Errors keep only their name and message (no stack, no
// extra properties); circular references are cut so one bad object can never break a log call.
function redact(value, seen = new WeakSet()) {
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      looksSecret(key) ? REDACTED : redact(item, seen),
    ]),
  );
}

const writeToStdout = (line) => process.stdout.write(`${line}\n`);

// One call = one JSON line. `write` is a parameter so tests can read what would be printed.
function createLogger({ write = writeToStdout, silent = false } = {}) {
  const logger = {};
  for (const level of LEVELS) {
    logger[level] = (message, fields = {}) => {
      if (silent) return;
      // time, level and message come last so a field can never overwrite them.
      write(
        JSON.stringify({
          ...redact(fields),
          time: new Date().toISOString(),
          level,
          message,
        }),
      );
    };
  }
  return logger;
}

// Tests would print a line per request; they build their own logger with a `write` to inspect.
module.exports = {
  logger: createLogger({ silent: env.NODE_ENV === "test" }),
  createLogger,
  redact,
};
