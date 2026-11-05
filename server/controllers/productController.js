const { UniqueConstraintError } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { pageBody, pageWindow } = require("../helpers/pagination");
const { tenant } = require("../helpers/tenantScope");

// Only the documented fields leave the server (docs/04).
const toProduct = (row) => ({
  id: row.id,
  organizationId: row.organizationId,
  sku: row.sku,
  name: row.name,
  unit: row.unit,
  minStock: row.minStock,
  archivedAt: row.archivedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const isOwner = (ctx) => ctx.role === "OWNER";

// Products belong to the organization, not to a warehouse, so every tenant role sees all of them.
// Archived ones are for the Owner only, and only when asked for.
const listFilter = (ctx, includeArchived) => (isOwner(ctx) && includeArchived ? {} : { archivedAt: null });

async function list(req, res) {
  const where = listFilter(req.ctx, req.valid.query.includeArchived);
  const products = tenant(req.ctx).Product;

  const [total, rows] = await Promise.all([
    products.count({ where }),
    products.findAll({
      where,
      order: [["sku", "ASC"], ["id", "ASC"]],
      ...pageWindow(req.valid.query),
    }),
  ]);
  res.status(200).json(pageBody(rows.map(toProduct), total, req.valid.query));
}

// Missing, malformed and foreign IDs are one 404 (findOwned). An archived product looks the same
// to everyone but the Owner: 404 too, so its existence is not revealed.
async function show(req, res) {
  const product = await findOwned(req.ctx, "Product", req.params.id);
  if (product.archivedAt && !isOwner(req.ctx)) throw notFound();
  res.status(200).json(toProduct(product));
}

// The unique key (organizationId, sku) decides "SKU exists", so a race cannot create two.
function rethrowDuplicateSku(err) {
  if (err instanceof UniqueConstraintError) throw conflict("SKU sudah dipakai.");
  throw err;
}

// organizationId is added by the tenant-scoped create from the context, never from the body.
async function create(req, res) {
  const row = await tenant(req.ctx).Product.create(req.valid.body).catch(rethrowDuplicateSku);
  res.status(201).json(toProduct(row));
}

// An archived product is not found here (404): E3-06 lets it through for a restore only.
async function update(req, res) {
  const product = await findOwned(req.ctx, "Product", req.params.id);
  if (product.archivedAt) throw notFound();

  await product.update(req.valid.body).catch(rethrowDuplicateSku);
  res.status(200).json(toProduct(product));
}

module.exports = { list, show, create, update, toProduct };
