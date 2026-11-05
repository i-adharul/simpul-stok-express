const { Op } = require("sequelize");
const { notFound, validationError } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");

// Warehouse assignment (BL10): who of the organization may work in a warehouse. Only a Warehouse
// Admin or a Viewer is assigned; an Owner reaches every active warehouse without any row.
const ASSIGNABLE_ROLES = ["WAREHOUSE_ADMIN", "VIEWER"];

// The warehouse of the URL, as the Owner's own and not archived. Missing, malformed, foreign and
// archived are one and the same 404 (findOwned, then the archived check).
async function findActiveWarehouse(ctx, id, options) {
  const warehouse = await findOwned(ctx, "Warehouse", id, options);
  if (warehouse.archivedAt) throw notFound();
  return warehouse;
}

// Everyone who can be assigned, with a flag for this warehouse. Two scoped queries, no include
// (tenantScope does not filter included models, ADR 0011).
async function listCandidates(ctx, warehouseId, options = {}) {
  const users = await tenant(ctx).User.findAll({
    where: { isActive: true, role: { [Op.in]: ASSIGNABLE_ROLES } },
    attributes: ["id", "name", "email", "role"],
    order: [["name", "ASC"], ["id", "ASC"]],
    ...options,
  });
  const links = await tenant(ctx).UserWarehouse.findAll({ where: { warehouseId }, attributes: ["userId"], ...options });
  const assigned = new Set(links.map((link) => link.userId));
  return users.map(({ id, name, email, role }) => ({ id, name, email, role, assigned: assigned.has(id) }));
}

async function getMembers(ctx, warehouseId) {
  const warehouse = await findActiveWarehouse(ctx, warehouseId);
  return { candidates: await listCandidates(ctx, warehouse.id) };
}

// Every ID must be a user of this organization (missing and foreign are the same 404, as in
// findOwned) and then an active Warehouse Admin or Viewer (400, one generic message that does not
// say which user or why). The existence check comes first, so the 400 can never reveal a user of
// another organization.
async function assertAssignable(ctx, userIds) {
  if (userIds.length === 0) return;
  const users = await tenant(ctx).User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "role", "isActive"] });
  if (users.length !== userIds.length) throw notFound();
  if (users.some((user) => !user.isActive || !ASSIGNABLE_ROLES.includes(user.role))) {
    throw validationError([{ source: "body", path: "userIds", message: "Ada pengguna yang tidak dapat ditugaskan." }]);
  }
}

// Makes the rows of the warehouse equal to `userIds`: removes the ones that are no longer wanted,
// adds the new ones, leaves the rest. Repeating it changes nothing.
async function applyAssignment(ctx, warehouseId, userIds, options = {}) {
  const existing = await tenant(ctx).UserWarehouse.findAll({ where: { warehouseId }, ...options });
  const wanted = new Set(userIds);
  const present = new Set(existing.map((row) => row.userId));

  for (const row of existing) {
    if (!wanted.has(row.userId)) await row.destroy(options);
  }
  for (const userId of userIds) {
    if (!present.has(userId)) await tenant(ctx).UserWarehouse.create({ userId, warehouseId }, options);
  }
}

async function replaceMembers(ctx, warehouseId, userIds) {
  const warehouse = await findActiveWarehouse(ctx, warehouseId);
  await assertAssignable(ctx, userIds);
  await applyAssignment(ctx, warehouse.id, userIds);
  return { candidates: await listCandidates(ctx, warehouse.id) };
}

module.exports = {
  replaceMembers, ASSIGNABLE_ROLES, getMembers, listCandidates, findActiveWarehouse };
