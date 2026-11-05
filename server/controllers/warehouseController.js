const { Op } = require("sequelize");
const { forbidden, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { pageBody, pageWindow } = require("../helpers/pagination");
const { tenant } = require("../helpers/tenantScope");
const warehouseService = require("../services/warehouseService");

// Only the documented fields leave the server (docs/04), so a column added later is not exposed
// by accident.
const toWarehouse = (row) => ({
  id: row.id,
  organizationId: row.organizationId,
  code: row.code,
  name: row.name,
  address: row.address,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const isOwner = (ctx) => ctx.role === "OWNER";

// Which warehouses a list may show. The Owner sees every active one (and the archived ones when
// asked). Anyone else sees only the assigned ones: ctx.warehouseIds already holds just those that
// are active, so `includeArchived` has no effect for them.
function listFilter(ctx, includeArchived) {
  if (!isOwner(ctx)) return { id: { [Op.in]: ctx.warehouseIds } };
  return includeArchived ? {} : { archivedAt: null };
}

async function list(req, res) {
  const { includeArchived } = req.valid.query;
  const where = listFilter(req.ctx, includeArchived);
  const warehouses = tenant(req.ctx).Warehouse;

  const [total, rows] = await Promise.all([
    warehouses.count({ where }),
    warehouses.findAll({
      where,
      order: [["code", "ASC"], ["id", "ASC"]],
      ...pageWindow(req.valid.query),
    }),
  ]);
  res.status(200).json(pageBody(rows.map(toWarehouse), total, req.valid.query));
}

// 404 comes first (missing or foreign: findOwned), then 404 for an archived warehouse to anyone
// but the Owner, then 403 for a warehouse the caller is not assigned to. The assignment check
// runs only for an existing, visible warehouse, so a 403 never reveals a foreign ID.
function assertVisible(ctx, warehouse) {
  if (isOwner(ctx)) return;
  if (warehouse.archivedAt) throw notFound();
  if (!ctx.warehouseIds.includes(warehouse.id)) throw forbidden();
}

// Two scoped queries instead of an include: tenantScope does not filter included models (ADR
// 0011), so a join could show a user of another organization. Each query here carries the filter.
async function findAssignedUsers(ctx, warehouseId) {
  const links = await tenant(ctx).UserWarehouse.findAll({ where: { warehouseId }, attributes: ["userId"] });
  if (links.length === 0) return [];

  const users = await tenant(ctx).User.findAll({
    where: { id: { [Op.in]: links.map((link) => link.userId) }, isActive: true },
    attributes: ["id", "name", "role"],
    order: [["name", "ASC"], ["id", "ASC"]],
  });
  return users.map(({ id, name, role }) => ({ id, name, role }));
}

async function show(req, res) {
  const warehouse = await findOwned(req.ctx, "Warehouse", req.params.id);
  assertVisible(req.ctx, warehouse);
  const assignedUsers = await findAssignedUsers(req.ctx, warehouse.id);
  res.status(200).json({ ...toWarehouse(warehouse), assignedUsers });
}

async function create(req, res) {
  const row = await warehouseService.createWarehouse(req.ctx, req.valid.body);
  res.status(201).json(toWarehouse(row));
}

async function update(req, res) {
  const row = await warehouseService.updateWarehouse(req.ctx, req.params.id, req.valid.body);
  res.status(200).json(toWarehouse(row));
}

module.exports = { list, show, create, update, toWarehouse };
