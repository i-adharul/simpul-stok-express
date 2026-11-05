const { UniqueConstraintError } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");

// Business rules of the product (BL09). It knows nothing about HTTP: the controller passes the
// request context and the validated body, and gets a row back or an AppError thrown.

// The unique key (organizationId, sku) decides "SKU exists", so a race cannot create two. An
// archived product keeps its SKU reserved, because the key covers every row.
function rethrowDuplicateSku(err) {
  if (err instanceof UniqueConstraintError) throw conflict("SKU sudah dipakai.");
  throw err;
}

// organizationId is added by the tenant-scoped create from the context, never from the body.
const createProduct = (ctx, values) => tenant(ctx).Product.create(values).catch(rethrowDuplicateSku);

// `archived: true` archives, `archived: false` restores, absent leaves it as it is. Unlike a
// warehouse, a product may be archived while it still has stock (BL09): its remaining stock can
// still be adjusted to zero (E4-04). An archived product is found only when it is being restored.
async function updateProduct(ctx, id, body) {
  const { archived, ...fields } = body;
  const product = await findOwned(ctx, "Product", id);
  if (product.archivedAt && archived !== false) throw notFound();

  const values = { ...fields };
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null;
  await product.update(values).catch(rethrowDuplicateSku);
  return product;
}

module.exports = { createProduct, updateProduct };
