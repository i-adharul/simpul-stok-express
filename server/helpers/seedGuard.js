const env = require("../config/env");

// Hosts that mean "this computer". An empty host or a path (a Unix socket) is local too.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalHost(host) {
  return !host || host.startsWith("/") || LOCAL_HOSTS.has(host);
}

// The seed has public demo passwords, so it must not reach a shared or production database by
// accident. It looks at the host the connection will really use, not at the env variable name.
// Only the host is put in the message: the full URL holds the password.
function assertSeedAllowed(sequelize, allowRemote = env.SEED_ALLOW_REMOTE) {
  const host = sequelize.config.host;
  if (isLocalHost(host) || allowRemote === true) return;
  throw new Error(
    `Refusing to seed: the database host "${host}" is not local. ` +
      "Set SEED_ALLOW_REMOTE=true only if you are sure.",
  );
}

module.exports = { assertSeedAllowed, isLocalHost };
