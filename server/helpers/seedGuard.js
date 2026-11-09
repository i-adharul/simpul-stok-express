const env = require("../config/env");
const { validatePassword } = require("./password");

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

// Which password the seeded accounts get. Locally the public demo password is fine. On a remote
// database it is not: the account would be open to anyone who has read the repository, so a strong
// SEED_PASSWORD is required. Messages never contain the password itself.
function resolveSeedPassword(
  sequelize,
  { seedPassword = env.SEED_PASSWORD, demoPassword },
) {
  if (isLocalHost(sequelize.config.host)) return seedPassword ?? demoPassword;
  if (!seedPassword)
    throw new Error("Refusing to seed a remote database: set SEED_PASSWORD.");
  if (seedPassword === demoPassword)
    throw new Error(
      "Refusing to seed a remote database with the public demo password.",
    );
  const check = validatePassword(seedPassword);
  if (!check.valid)
    throw new Error(
      `Refusing to seed a remote database: SEED_PASSWORD is too weak (${check.reason}).`,
    );
  return seedPassword;
}

module.exports = { assertSeedAllowed, isLocalHost, resolveSeedPassword };
