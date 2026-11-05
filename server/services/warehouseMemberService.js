const { Op } = require("sequelize");
const { notFound } = require("../helpers/errors");
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

module.exports = { ASSIGNABLE_ROLES, getMembers, listCandidates, findActiveWarehouse };
