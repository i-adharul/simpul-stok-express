const env = require("./env");

// sequelize-cli reads this file (see .sequelizerc). It is a .js file, not
// config.json, so credentials come from the validated env and never from the repo.
//
// Pool: Sequelize has no per-transaction timeout. A transaction holds one pooled connection from
// BEGIN to COMMIT, and the default pool (max 5, wait 60 s) lets a request that waits for a free
// connection hang for a minute. The pool is sized for the five parallel same-key requests the
// idempotency test sends, and `acquire` is 10 s, so a starved pool fails fast with an error
// instead of hanging (ADR 0012). Work inside a transaction must pass `{ transaction }` to every
// query, or it asks for a second connection while holding the first.
const base = {
  dialect: "postgres",
  logging: false,
  pool: { max: 10, min: 0, acquire: 10000, idle: 10000 },
};

module.exports = {
  development: { ...base, url: env.DATABASE_URL },
  // Tests empty their tables, so they get their own database.
  test: { ...base, url: env.TEST_DATABASE_URL },
  production: {
    ...base,
    url: env.DATABASE_URL,
    // Supabase only accepts TLS connections. Certificate pinning is decided at deploy (E6-04).
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  },
};
