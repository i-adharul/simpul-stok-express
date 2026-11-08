const { Op, col, where: columnWhere } = require("sequelize");
const { forbidden } = require("../helpers/errors");
const { can } = require("../helpers/permissions");
const { tenant } = require("../helpers/tenantScope");

// Read-only summary of stock per (warehouse, product) pair (BL15, S09). Only pairs that HAVE a stock
// row exist here; the UI draws the strip for pairs without one. No transaction and no lock: it
// only reads, and a count that is one write behind is fine for a summary.

// Status of a pair uses the minimum of its own product (docs/04): OUT when quantity is 0, LOW when it
// is above 0 and below minStock, OK otherwise (so minStock 0 or 1 is never LOW).
const STATUS_FILTERS = {
  OUT: () => ({ quantity: 0 }),
  LOW: () => ({ [Op.and]: [{ quantity: { [Op.gt]: 0 } }, columnWhere(col("StockLevel.quantity"), Op.lt, col("Product.minStock"))] }),
  OK: () => ({ [Op.and]: [{ quantity: { [Op.gt]: 0 } }, columnWhere(col("StockLevel.quantity"), Op.gte, col("Product.minStock"))] }),
};

// "100%" must find the text "100%", not everything: the LIKE wildcards of the user's text are escaped.
const likePattern = (text) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

// The warehouses to read. A warehouseId is authorized FIRST: one 403 for a warehouse that is
// unassigned, archived, foreign or missing (ctx.warehouseIds holds only the caller's active ones),
// so the answer never says which. Without it, every warehouse the caller may reach.
function warehouseScope(ctx, warehouseId) {
  if (warehouseId === undefined) return ctx.warehouseIds;
  if (!can(ctx, "stock.read", { warehouseId })) throw forbidden();
  return [warehouseId];
}

// The joined rows are filtered by organization explicitly: tenantScope filters the main model only,
// not an include (ADR 0011). Rows of archived products count only while they still hold stock.
function productInclude(ctx, { q }) {
  const productWhere = { organizationId: ctx.organizationId };
  if (q) productWhere[Op.or] = [{ sku: { [Op.iLike]: likePattern(q) } }, { name: { [Op.iLike]: likePattern(q) } }];
  return { association: "Product", required: true, where: productWhere, attributes: ["id", "sku", "name", "unit", "minStock", "archivedAt"] };
}

const warehouseInclude = (ctx) => ({
  association: "Warehouse",
  required: true,
  where: { organizationId: ctx.organizationId },
  attributes: ["id", "code", "name"],
});

// Everything except `status`, shared by the page, the total and the three summary counts.
function baseWhere(warehouseIds, { productId }) {
  const conditions = [{ warehouseId: { [Op.in]: warehouseIds } }];
  if (productId) conditions.push({ productId });
  conditions.push({ [Op.or]: [{ "$Product.archivedAt$": null }, { quantity: { [Op.gt]: 0 } }] });
  return { [Op.and]: conditions };
}

const withStatus = (base, status) => (status ? { [Op.and]: [base, STATUS_FILTERS[status]()] } : base);

const toItem = (row) => ({
  warehouse: { id: row.Warehouse.id, code: row.Warehouse.code, name: row.Warehouse.name },
  product: {
    id: row.Product.id,
    sku: row.Product.sku,
    name: row.Product.name,
    unit: row.Product.unit,
    minStock: row.Product.minStock,
    archived: row.Product.archivedAt !== null,
  },
  quantity: row.quantity,
  status: row.quantity === 0 ? "OUT" : row.quantity < row.Product.minStock ? "LOW" : "OK",
  updatedAt: row.updatedAt,
});

// `query` is the validated query (schemas/stock.schema.js): warehouseId, productId, q, status,
// page, pageSize. Returns the body of GET /api/stock.
async function listStock(ctx, query) {
  const warehouseIds = warehouseScope(ctx, query.warehouseId);
  const levels = tenant(ctx).StockLevel;
  const includes = [productInclude(ctx, query), warehouseInclude(ctx)];
  const base = baseWhere(warehouseIds, query);
  const countOf = (status) => levels.count({ where: withStatus(base, status), include: includes });

  const [rows, total, out, low, ok] = await Promise.all([
    levels.findAll({
      where: withStatus(base, query.status),
      include: includes,
      order: [[col("Product.name"), "ASC"], [col("Warehouse.code"), "ASC"], ["warehouseId", "ASC"], ["productId", "ASC"]],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }),
    countOf(query.status),
    countOf("OUT"),
    countOf("LOW"),
    countOf("OK"),
  ]);

  return { items: rows.map(toItem), total, page: query.page, pageSize: query.pageSize, summary: { out, low, ok } };
}

module.exports = { listStock, STATUS_FILTERS };
