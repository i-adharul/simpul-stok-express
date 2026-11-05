const { User } = require("../models");

// Login is the one place that reads a user before any organization is known, so these two calls
// are not tenant-scoped on purpose. Everything after login loads the user through the request
// context instead. Keep this file small: every function here can see all tenants.

// `email` must already be trimmed and lowercase (loginSchema does that).
const findUserByEmail = (email) => User.findOne({ where: { email } });

const touchLastLogin = (userId) =>
  User.update({ lastLoginAt: new Date() }, { where: { id: userId } });

module.exports = { findUserByEmail, touchLastLogin };
