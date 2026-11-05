const { Op } = require("sequelize");
const { encodeCursor } = require("../helpers/cursor");
const { notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");

// The stock history (BL16, S10): newest first, a page of 50, keyset pagination. Read-only.
const PAGE_SIZE = 50;

// Only movements of the warehouses the caller reaches (ctx.warehouseIds: all active ones for an
// Owner, the assigned ones for the others). A `warehouseId` filter outside that set is NOT a 403
// here: it narrows to nothing, so the answer is an empty list (docs/04).
function warehouseCondition(ctx, warehouseId) {
  const reachable = warehouseId === undefined ? ctx.warehouseIds : ctx.warehouseIds.filter((id) => id === warehouseId);
  return { warehouseId: { [Op.in]: reachable } };
}

function createdAtRange({ from, to }) {
  const range = {};
  if (from) range[Op.gte] = from; // inclusive
  if (to) range[Op.lt] = to; // exclusive
  return Object.getOwnPropertySymbols(range).length > 0 ? { createdAt: range } : null;
}

// Order is createdAt DESC, id ASC (the same as the index). "After the cursor" in that order is:
// older than the cursor's instant, or the same instant with a larger id.
const afterCursor = ({ createdAt, id }) => ({
  [Op.or]: [{ createdAt: { [Op.lt]: createdAt } }, { [Op.and]: [{ createdAt }, { id: { [Op.gt]: id } }] }],
});

function buildWhere(ctx, query) {
  const conditions = [warehouseCondition(ctx, query.warehouseId)];
  for (const key of ["productId", "type", "createdById"]) {
    if (query[key] !== undefined) conditions.push({ [key]: query[key] });
  }
  const range = createdAtRange(query);
  if (range) conditions.push(range);
  if (query.cursor) conditions.push(afterCursor(query.cursor));
  return { [Op.and]: conditions };
}

const toItem = (row) => ({
  id: row.id,
  warehouseId: row.warehouseId,
  productId: row.productId,
  type: row.type,
  quantityDelta: row.quantityDelta,
  reason: row.reason,
  note: row.note,
  transferId: row.transferId,
  createdById: row.createdById,
  createdAt: row.createdAt,
});

// `query` is validated: productId, warehouseId, type, createdById, from and to (Date), cursor
// ({ createdAt, id } already decoded). One extra row is read to know whether another page exists.
async function listMovements(ctx, query) {
  const rows = await tenant(ctx).StockMovement.findAll({
    where: buildWhere(ctx, query),
    order: [["createdAt", "DESC"], ["id", "ASC"]],
    limit: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return { items: page.map(toItem), nextCursor: rows.length > PAGE_SIZE ? encodeCursor(last) : null };
}

// One movement with the names around it (S10, P13). Four situations are ONE 404: a malformed ID, a
// missing one, another organization's (findOwned), and one in a warehouse outside the caller's
// reach (ctx.warehouseIds), so the answer never says which. The related rows are read with
// separate scoped queries, not an include (ADR 0011); the email of a user is never selected.
async function getMovement(ctx, id) {
  const movement = await findOwned(ctx, "StockMovement", id);
  if (!ctx.warehouseIds.includes(movement.warehouseId)) throw notFound();

  const scoped = tenant(ctx);
  const [warehouse, product, createdBy, transfer] = await Promise.all([
    scoped.Warehouse.findByPk(movement.warehouseId, { attributes: ["id", "code", "name"] }),
    scoped.Product.findByPk(movement.productId, { attributes: ["id", "sku", "name", "unit"] }),
    movement.createdById ? scoped.User.findByPk(movement.createdById, { attributes: ["id", "name", "role"] }) : null,
    movement.transferId ? describeTransfer(ctx, movement.transferId) : null,
  ]);

  return {
    ...toItem(movement),
    warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
    product: { id: product.id, sku: product.sku, name: product.name, unit: product.unit },
    createdBy: createdBy ? { id: createdBy.id, name: createdBy.name, role: createdBy.role } : null,
    transfer,
  };
}

// The transfer behind a TRANSFER_OUT or TRANSFER_IN movement, with the names of both warehouses.
async function describeTransfer(ctx, transferId) {
  const scoped = tenant(ctx);
  const transfer = await scoped.StockTransfer.findByPk(transferId, { attributes: ["id", "code", "fromWarehouseId", "toWarehouseId"] });
  if (!transfer) return null;
  const [from, to] = await Promise.all([
    scoped.Warehouse.findByPk(transfer.fromWarehouseId, { attributes: ["id", "name"] }),
    scoped.Warehouse.findByPk(transfer.toWarehouseId, { attributes: ["id", "name"] }),
  ]);
  return { id: transfer.id, code: transfer.code, fromWarehouse: { id: from.id, name: from.name }, toWarehouse: { id: to.id, name: to.name } };
}

module.exports = { listMovements, getMovement, PAGE_SIZE };
