const { UniqueConstraintError } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { assertWithinLimit, lockOrganization } = require("./planLimitService");

// Business rules of the product (BL09). It knows nothing about HTTP: the controller passes the
// request context and the validated body, and gets a row back or an AppError thrown.

// The unique key (organizationId, sku) decides "SKU exists", so a race cannot create two. An
// archived product keeps its SKU reserved, because the key covers every row.
function rethrowDuplicateSku(err) {
  if (err instanceof UniqueConstraintError) throw conflict("SKU sudah dipakai.");
  throw err;
}

// BL20. One transaction: the organization row is locked first, the plan limit is checked, and only
// then is the row written, so two simultaneous creates at the last slot cannot both pass.
// organizationId is added by the tenant-scoped create from the context, never from the body.
function createProduct(ctx, values) {
  return inTransaction(async (transaction) => {
    await lockOrganization(ctx.organizationId, transaction);
    await assertWithinLimit(ctx.organizationId, "PRODUCT", { transaction });
    return tenant(ctx).Product.create(values, { transaction }).catch(rethrowDuplicateSku);
  });
}

// `archived: true` archives, `archived: false` restores, absent leaves it as it is. Unlike a
// warehouse, a product may be archived while it still has stock (BL09): its remaining stock can
// still be adjusted to zero (E4-04). An archived product is found only when it is being restored.
//
// A restore adds an active product again, so it is checked like a create (BL20, P03). It runs in one
// transaction that takes the organization lock first, reads the row again under it and only checks the
// limit when the product really is archived at that moment.
function updateProduct(ctx, id, body) {
  const { archived, ...fields } = body;
  return inTransaction(async (transaction) => {
    if (archived === false) await lockOrganization(ctx.organizationId, transaction);
    const product = await findOwned(ctx, "Product", id, { transaction });
    if (product.archivedAt && archived !== false) throw notFound();
    if (archived === false && product.archivedAt) {
      await assertWithinLimit(ctx.organizationId, "PRODUCT", { transaction });
    }

    const values = { ...fields };
    if (archived !== undefined) values.archivedAt = archived ? new Date() : null;
    await product.update(values, { transaction }).catch(rethrowDuplicateSku);
    return product;
  });
}

module.exports = { createProduct, updateProduct };
