const { Op, literal } = require("sequelize");
const { pageBody, pageWindow } = require("../helpers/pagination");
const { tenant } = require("../helpers/tenantScope");

// Members of the organization (BL07). It knows nothing about HTTP: the controller passes the
// request context and the validated query.

// The Owner first, then by name (then by ID, so the order is stable). The literal puts the Owner at 0
// and everyone else at 1; ordering by the role column itself would put Warehouse Admins before Viewers.
const OWNER_FIRST = literal(`CASE WHEN "User"."role" = 'OWNER' THEN 0 ELSE 1 END`);

// The warehouses each of these users is assigned to: only ACTIVE warehouses, with id and code.
// Two scoped queries and no include, because tenantScope does not filter included models (ADR 0011):
// each query carries the organization filter, so a link or warehouse of another organization can
// never show up here. Returns a Map userId -> [{ id, code }] ordered by code.
async function assignedWarehouses(ctx, userIds) {
  const byUser = new Map(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return byUser;

  const links = await tenant(ctx).UserWarehouse.findAll({
    where: { userId: { [Op.in]: userIds } },
    attributes: ["userId", "warehouseId"],
  });
  const warehouses = await tenant(ctx).Warehouse.findAll({
    where: { id: { [Op.in]: [...new Set(links.map((link) => link.warehouseId))] }, archivedAt: null },
    attributes: ["id", "code"],
    order: [["code", "ASC"], ["id", "ASC"]],
  });

  for (const warehouse of warehouses) {
    for (const link of links) {
      if (link.warehouseId === warehouse.id) byUser.get(link.userId).push({ id: warehouse.id, code: warehouse.code });
    }
  }
  return byUser;
}

// Only the documented fields: never `passwordHash`, `resetTokenHash` or `resetExpiresAt` (they are not
// even selected). An Owner reaches every warehouse without any assignment row, so the Owner gets
// `allWarehouses: true` and an empty list.
const toMember = (user, warehouses) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
  allWarehouses: user.role === "OWNER",
  warehouses: user.role === "OWNER" ? [] : warehouses,
});

// All users of the own organization, active and inactive, the Owner included. A Platform admin has no
// organization, so the tenant filter can never match one.
async function list(ctx, query) {
  const users = tenant(ctx).User;
  const [total, rows] = await Promise.all([
    users.count(),
    users.findAll({
      attributes: ["id", "name", "email", "role", "isActive", "lastLoginAt"],
      order: [OWNER_FIRST, ["name", "ASC"], ["id", "ASC"]],
      ...pageWindow(query),
    }),
  ]);
  const warehouses = await assignedWarehouses(ctx, rows.map((row) => row.id));
  return pageBody(rows.map((row) => toMember(row, warehouses.get(row.id))), total, query);
}

module.exports = { list, toMember };
