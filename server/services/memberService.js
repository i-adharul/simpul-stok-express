const { Op, literal } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { pageBody, pageWindow } = require("../helpers/pagination");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { getEffectiveLimits, getUsage } = require("./planLimitService");
const { lockWarehouse } = require("./warehouseLock");

// Members of the organization (BL07). It knows nothing about HTTP: the controller passes the
// request context and the validated query.

// The Owner first, then by name (then by ID, so the order is stable). The literal puts the Owner at 0
// and everyone else at 1; ordering by the role column itself would put Warehouse Admins before Viewers.
const OWNER_FIRST = literal(`CASE WHEN "User"."role" = 'OWNER' THEN 0 ELSE 1 END`);

// The warehouses each of these users is assigned to: only ACTIVE warehouses, with id and code.
// Two scoped queries and no include, because tenantScope does not filter included models (ADR 0011):
// each query carries the organization filter, so a link or warehouse of another organization can
// never show up here. Returns a Map userId -> [{ id, code }] ordered by code.
async function assignedWarehouses(ctx, userIds, options = {}) {
  const byUser = new Map(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return byUser;

  const links = await tenant(ctx).UserWarehouse.findAll({
    where: { userId: { [Op.in]: userIds } },
    attributes: ["userId", "warehouseId"],
    ...options,
  });
  const warehouses = await tenant(ctx).Warehouse.findAll({
    where: { id: { [Op.in]: [...new Set(links.map((link) => link.warehouseId))] }, archivedAt: null },
    attributes: ["id", "code"],
    order: [["code", "ASC"], ["id", "ASC"]],
    ...options,
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
  const usage = await memberUsage(ctx);
  return { ...pageBody(rows.map((row) => toMember(row, warehouses.get(row.id))), total, query), usage };
}

// The member indicator of S14 (BL20): ACTIVE users against the effective member limit. It counts
// active users only, so an inactive member in the list does not use a slot, and the Owner does.
async function memberUsage(ctx) {
  const [usage, limits] = await Promise.all([getUsage(ctx.organizationId), getEffectiveLimits(ctx.organizationId)]);
  return { used: usage.MEMBER, limit: limits.MEMBER };
}

// Replaces the assignment of the member as a whole (BL10): every wanted warehouse is locked in ID order
// (the order every writer uses, ADR 0013) and read again UNDER the lock. A missing, foreign or archived
// one is the same 404 (rule 2), so an archive that runs at the same moment either comes first (this
// call gets 404 and writes nothing) or waits for this transaction (the assignment is then complete).
async function replaceAssignment(ctx, userId, warehouseIds, transaction) {
  for (const warehouseId of [...warehouseIds].sort()) {
    const warehouse = await lockWarehouse(ctx, warehouseId, transaction);
    if (!warehouse || warehouse.archivedAt) throw notFound();
  }
  const old = await tenant(ctx).UserWarehouse.findAll({ where: { userId }, transaction });
  for (const row of old) await row.destroy({ transaction });
  for (const warehouseId of warehouseIds) {
    await tenant(ctx).UserWarehouse.create({ userId, warehouseId }, { transaction });
  }
}

// BL07. The member is found like any row of the organization (a malformed, missing or foreign ID is
// the same 404; a Platform admin has no organization, so it is never found) and the row is locked, so
// two changes of one member run one after the other. The Owner is protected: every change to an Owner
// is a 409, which also keeps the last Owner from being deactivated or demoted (there is exactly one).
// Role and status are read from the database on every request, so the change applies on the next
// request of that member without touching their token.
function update(ctx, id, body) {
  return inTransaction(async (transaction) => {
    const target = await findOwned(ctx, "User", id, { transaction, lock: transaction.LOCK.UPDATE });
    if (target.role === "OWNER") throw conflict("Pemilik tidak dapat diubah atau dinonaktifkan.");

    const { warehouseIds, ...fields } = body;
    if (Object.keys(fields).length > 0) await target.update(fields, { transaction });
    if (warehouseIds) await replaceAssignment(ctx, target.id, warehouseIds, transaction);

    const warehouses = await assignedWarehouses(ctx, [target.id], { transaction });
    return toMember(target, warehouses.get(target.id));
  });
}

module.exports = { list, update, toMember };
