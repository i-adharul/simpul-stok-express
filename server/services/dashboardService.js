const { Op, fn, col, literal } = require("sequelize");
const { wibDayRange } = require("../helpers/wibDay");
const { tenant } = require("../helpers/tenantScope");
const { STATUS_FILTERS } = require("./stockSummaryService");

// The dashboard (S04, BL16). Read-only: no transaction and no lock, a figure that is one write
// behind is fine. Every figure except `totalProducts` covers only the caller's warehouses
// (ctx.warehouseIds: all active ones for an Owner, the assigned ones for the others).

const reachable = (ctx) => ({ warehouseId: { [Op.in]: ctx.warehouseIds } });

// tenantScope filters the main model only, not an include (ADR 0011), so the joined products are
// filtered by organization here. Archived products are left out of the low and out counts.
const activeProduct = (ctx) => ({
  association: "Product",
  required: true,
  where: { organizationId: ctx.organizationId, archivedAt: null },
  attributes: [],
});

const countPairs = (ctx, status) =>
  tenant(ctx).StockLevel.count({ where: { [Op.and]: [reachable(ctx), STATUS_FILTERS[status]()] }, include: [activeProduct(ctx)] });

// The units of every stock row of the caller's warehouses, archived products included. SUM comes
// back as a string (bigint) or null (no rows): it is turned into a plain number here.
async function sumUnits(ctx) {
  const [row] = await tenant(ctx).StockLevel.findAll({
    where: reachable(ctx),
    attributes: [[fn("COALESCE", fn("SUM", col("quantity")), 0), "total"]],
    raw: true,
  });
  return Number(row.total);
}

// A transfer writes two movements, so it counts twice (docs/04). `now` can be given by a test.
const movementsOn = (ctx, now) => {
  const { from, to } = wibDayRange(now);
  return tenant(ctx).StockMovement.count({ where: { [Op.and]: [reachable(ctx), { createdAt: { [Op.gte]: from, [Op.lt]: to } }] } });
};

// Returns `summary` of GET /api/dashboard.
async function getSummary(ctx, now = new Date()) {
  const [totalProducts, totalUnits, lowCount, outCount, movementsToday] = await Promise.all([
    tenant(ctx).Product.count({ where: { archivedAt: null } }),
    sumUnits(ctx),
    countPairs(ctx, "LOW"),
    countPairs(ctx, "OUT"),
    movementsOn(ctx, now),
  ]);
  return { totalProducts, totalUnits, lowCount, outCount, movementsToday };
}

const RESTOCK_LIMIT = 5;
const ACTIVITY_LIMIT = 5;

// Pairs that are OUT or LOW, as the stock summary defines them (one definition, STATUS_FILTERS).
const needsRestock = (ctx) => ({ [Op.and]: [reachable(ctx), { [Op.or]: [STATUS_FILTERS.OUT(), STATUS_FILTERS.LOW()] }] });

const restockIncludes = (ctx) => [
  { ...activeProduct(ctx), attributes: ["id", "sku", "name", "unit", "minStock"] },
  { association: "Warehouse", required: true, where: { organizationId: ctx.organizationId }, attributes: ["id", "code", "name"] },
];

const toRestockItem = (row) => ({
  warehouse: { id: row.Warehouse.id, code: row.Warehouse.code, name: row.Warehouse.name },
  product: { id: row.Product.id, sku: row.Product.sku, name: row.Product.name, unit: row.Product.unit, minStock: row.Product.minStock },
  quantity: row.quantity,
  status: row.quantity === 0 ? "OUT" : "LOW",
});

// Returns `restock` of GET /api/dashboard: the 5 pairs furthest below their minimum, and how many
// pairs are short in all. The gap is minStock - quantity; ties are broken by name, then code, then
// ids, so two calls never answer in a different order.
async function getRestock(ctx) {
  const levels = tenant(ctx).StockLevel;
  const [rows, total] = await Promise.all([
    levels.findAll({
      where: needsRestock(ctx),
      include: restockIncludes(ctx),
      order: [
        [literal('"Product"."minStock" - "StockLevel"."quantity"'), "DESC"],
        [col("Product.name"), "ASC"],
        [col("Warehouse.code"), "ASC"],
        ["warehouseId", "ASC"],
        ["productId", "ASC"],
      ],
      limit: RESTOCK_LIMIT,
    }),
    levels.count({ where: needsRestock(ctx), include: [activeProduct(ctx)] }),
  ]);
  return { items: rows.map(toRestockItem), total };
}

const uniqueIds = (rows, key) => [...new Set(rows.map((row) => row[key]).filter(Boolean))];

// The names around the movements are read with separate scoped queries, not an include (ADR 0011);
// the email of a user is never selected.
async function namesOf(ctx, movements) {
  const scoped = tenant(ctx);
  const byIds = (Model, key, attributes) =>
    scoped[Model].findAll({ where: { id: { [Op.in]: uniqueIds(movements, key) } }, attributes });
  const [warehouses, products, users, transfers] = await Promise.all([
    byIds("Warehouse", "warehouseId", ["id", "code", "name"]),
    byIds("Product", "productId", ["id", "sku", "name", "unit"]),
    byIds("User", "createdById", ["id", "name"]),
    byIds("StockTransfer", "transferId", ["id", "code"]),
  ]);
  const index = (rows) => new Map(rows.map((row) => [row.id, row]));
  return { warehouses: index(warehouses), products: index(products), users: index(users), transfers: index(transfers) };
}

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key]]));

// Returns `recentActivity` of GET /api/dashboard: the 5 newest movements of the caller's warehouses,
// newest first (same order as the history, createdAt DESC then id ASC). Both movements of a transfer
// can show.
async function getRecentActivity(ctx) {
  const movements = await tenant(ctx).StockMovement.findAll({
    where: reachable(ctx),
    order: [["createdAt", "DESC"], ["id", "ASC"]],
    limit: ACTIVITY_LIMIT,
  });
  const names = await namesOf(ctx, movements);
  return movements.map((m) => ({
    id: m.id,
    type: m.type,
    quantityDelta: m.quantityDelta,
    reason: m.reason,
    createdAt: m.createdAt,
    warehouse: pick(names.warehouses.get(m.warehouseId), ["id", "code", "name"]),
    product: pick(names.products.get(m.productId), ["id", "sku", "name", "unit"]),
    createdBy: m.createdById ? pick(names.users.get(m.createdById), ["id", "name"]) : null,
    transfer: m.transferId ? pick(names.transfers.get(m.transferId), ["id", "code"]) : null,
  }));
}

// The body of GET /api/dashboard. Four independent reads, run together; a read-only answer needs no
// transaction (the figures may differ by one concurrent write, which a dashboard accepts).
async function getDashboard(ctx, now = new Date()) {
  const [summary, restock, recentActivity] = await Promise.all([getSummary(ctx, now), getRestock(ctx), getRecentActivity(ctx)]);
  return { summary, restock, recentActivity };
}

module.exports = { getDashboard, getSummary, getRestock, getRecentActivity, RESTOCK_LIMIT, ACTIVITY_LIMIT };
