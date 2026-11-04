const env = require("./env");

// sequelize-cli reads this file (see .sequelizerc). It is a .js file, not
// config.json, so credentials come from the validated env and never from the repo.
const base = { dialect: "postgres", logging: false };

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
