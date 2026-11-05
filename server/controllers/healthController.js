const env = require("../config/env");
const { checkDatabase } = require("../helpers/databaseHealth");

// Builds the handler from its dependencies so tests can give a database that is down.
function createHealthController({
  check = checkDatabase,
  commit = () => env.COMMIT_SHA,
} = {}) {
  return async function getHealth(req, res) {
    const database = await check();
    const up = database.status === "up";

    // A monitor must see the real state now, not a copy kept by a browser or a proxy.
    res.set("Cache-Control", "no-store");
    res.status(up ? 200 : 503).json({
      status: up ? "ok" : "error",
      app: { commit: commit() },
      database,
    });
  };
}

module.exports = createHealthController();
module.exports.createHealthController = createHealthController;
