const { Organization, User, UserWarehouse, Warehouse } = require("../models");

// Login is the one place that reads a user before any organization is known, so these two calls
// are not tenant-scoped on purpose. Everything after login loads the user through the request
// context instead. Keep this file small: every function here can see all tenants.

// `email` must already be trimmed and lowercase (loginSchema does that).
const findUserByEmail = (email) => User.findOne({ where: { email } });

const touchLastLogin = (userId) =>
  User.update({ lastLoginAt: new Date() }, { where: { id: userId } });

// The user behind a token, read again on every request together with their organization (one query),
// so a deactivation or a status change is seen at once. Never selects secrets: the password hash
// and the reset token stay in the database. A platform admin has no organization (null).
const findUserById = (id) =>
  User.findByPk(id, {
    attributes: [
      "id",
      "name",
      "email",
      "role",
      "isActive",
      "organizationId",
      "passwordChangedAt",
    ],
    include: [
      {
        model: Organization,
        attributes: ["id", "name", "slug", "status"],
        required: false,
      },
    ],
  });

// IDs of the active (not archived) warehouses of one organization, in a stable order. With a
// `userId` only the warehouses assigned to that user are returned. The organization filter is
// always applied, so an assignment row that points at a foreign warehouse can never leak it.
const findActiveWarehouseIds = async (organizationId, userId = null) => {
  const rows = await Warehouse.findAll({
    attributes: ["id"],
    where: { organizationId, archivedAt: null },
    include: userId
      ? [{ model: UserWarehouse, attributes: [], where: { userId }, required: true }]
      : [],
    order: [["id", "ASC"]],
    raw: true,
  });
  return rows.map((row) => row.id);
};

// Only the password flows need the hash, so it has its own reader instead of widening findUserById.
const findUserWithPasswordHash = (id) =>
  User.findByPk(id, { attributes: ["id", "email", "passwordHash"] });

// `changedAt` is set by the caller so the new token can be issued at or after the same instant.
const savePassword = (userId, passwordHash, changedAt) =>
  User.update({ passwordHash, passwordChangedAt: changedAt }, { where: { id: userId } });

module.exports = {
  findUserByEmail,
  touchLastLogin,
  findUserById,
  findActiveWarehouseIds,
  findUserWithPasswordHash,
  savePassword,
};
