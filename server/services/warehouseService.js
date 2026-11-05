const { Op, UniqueConstraintError } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");

// Business rules of the warehouse (BL08). It knows nothing about HTTP: the controller passes the
// request context and the validated body, and gets a row back or an AppError thrown.

// The unique key (organizationId, code) is the single source of truth for "code exists": the
// database decides, so two requests racing for one code cannot both succeed. No check-then-insert.
function rethrowDuplicateCode(err) {
  if (err instanceof UniqueConstraintError) throw conflict("Kode gudang sudah dipakai.");
  throw err;
}

// organizationId is added by the tenant-scoped create from the context, never from the body.
const createWarehouse = (ctx, values) => tenant(ctx).Warehouse.create(values).catch(rethrowDuplicateCode);

// A warehouse may only be archived when every stock row of it is 0 (BL08).
// TODO(E4-02 step 4): take the warehouse row lock around this check and the update, so stock
// cannot arrive between the check and the archive.
async function assertNoStock(ctx, warehouseId) {
  const stocked = await tenant(ctx).StockLevel.count({ where: { warehouseId, quantity: { [Op.gt]: 0 } } });
  if (stocked > 0) throw conflict("Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan.");
}

// `archived: true` archives, `archived: false` restores, absent leaves it as it is. An archived
// warehouse is found only when it is being restored (404 otherwise), as in docs/04.
async function updateWarehouse(ctx, id, body) {
  const { archived, ...fields } = body;
  const warehouse = await findOwned(ctx, "Warehouse", id);
  if (warehouse.archivedAt && archived !== false) throw notFound();
  if (archived === true) await assertNoStock(ctx, warehouse.id);

  const values = { ...fields };
  if (archived !== undefined) values.archivedAt = archived ? new Date() : null;
  await warehouse.update(values).catch(rethrowDuplicateCode);
  return warehouse;
}

module.exports = { createWarehouse, updateWarehouse };
