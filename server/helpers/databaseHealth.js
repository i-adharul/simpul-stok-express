const UP_TTL_MS = 60 * 1000;
const DOWN_TTL_MS = 15 * 1000;
// A database that does not answer must not make the health endpoint hang as well.
const PING_TIMEOUT_MS = 3000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("ping timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Returns a function that tells whether the database answers. The answer is remembered inside
// this server process: 60 s when up, 15 s when down, so a monitor that calls often does not hit
// the database every time, and a down database is retried sooner.
// It resolves to { status: "up", latencyMs } or { status: "down" } and never rejects: the error
// text, the host and the database version must not reach the response (docs/04).
function createDatabaseCheck(
  ping,
  { now = Date.now, onFailure = () => {} } = {},
) {
  let cached = null; // { result, expiresAt }
  let inFlight = null; // a check that is running, shared by callers that arrive meanwhile

  async function run() {
    const startedAt = now();
    try {
      await withTimeout(ping(), PING_TIMEOUT_MS);
      return { status: "up", latencyMs: now() - startedAt };
    } catch (error) {
      onFailure(error);
      return { status: "down" };
    }
  }

  return function checkDatabase() {
    if (cached && now() < cached.expiresAt)
      return Promise.resolve(cached.result);
    if (inFlight) return inFlight;

    inFlight = run()
      .then((result) => {
        const ttl = result.status === "up" ? UP_TTL_MS : DOWN_TTL_MS;
        cached = { result, expiresAt: now() + ttl };
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}

// The real check: SELECT 1 on the application's own connection pool.
// The models are loaded on first use, so requiring this file opens no connection.
let defaultCheck;
function checkDatabase() {
  if (!defaultCheck) {
    const { sequelize } = require("../models");
    const { logger } = require("./logger");
    defaultCheck = createDatabaseCheck(() => sequelize.query("SELECT 1"), {
      // Only the error name: its message can contain the host.
      onFailure: (error) =>
        logger.warn("database health check failed", { error: error.name }),
    });
  }
  return defaultCheck();
}

module.exports = {
  createDatabaseCheck,
  checkDatabase,
  UP_TTL_MS,
  DOWN_TTL_MS,
  PING_TIMEOUT_MS,
};
