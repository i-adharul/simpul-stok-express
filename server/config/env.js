const dotenv = require("dotenv");
const { parseEnv } = require("./envSchema");

// Variables already set by the shell or the host win over the .env file.
dotenv.config({ quiet: true });

function load() {
  try {
    return Object.freeze(parseEnv(process.env));
  } catch (error) {
    // Fail at start, before the server listens, so a bad deploy never serves.
    console.error(error.message);
    process.exit(1);
  }
}

// The only place that reads process.env (CLAUDE.md rule 5);
// config/config.js is the one written exception.
module.exports = load();
