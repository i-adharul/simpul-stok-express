// Matches a bcrypt hash made with the given cost, without pinning the version letter ($2a$, $2b$, $2y$).
const bcryptPrefix = (cost) => new RegExp(`^\\$2[aby]\\$${String(cost).padStart(2, "0")}\\$`);

module.exports = { bcryptPrefix };
