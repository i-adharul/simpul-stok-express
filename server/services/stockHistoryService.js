const { Op } = require("sequelize");
const { encodeCursor } = require("../helpers/cursor");
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

module.exports = { listMovements, PAGE_SIZE };
