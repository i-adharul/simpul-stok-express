const { Op, UniqueConstraintError } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { lockWarehouse } = require("./warehouseLock");

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

// A warehouse may only be archived when every stock row of it is 0 (BL08). Runs inside the
// transaction that holds the warehouse lock, so no stock can arrive between this check and the
// archive: a stock writer waits for the lock (ADR 0013).
async function assertNoStock(ctx, warehouseId, transaction) {
  const stocked = await tenant(ctx).StockLevel.count({ where: { warehouseId, quantity: { [Op.gt]: 0 } }, transaction });
  if (stocked > 0) throw conflict("Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan.");
}

// `archived: true` archives, `archived: false` restores, absent leaves it as it is. An archived
// warehouse is found only when it is being restored (404 otherwise), as in docs/04.
// findOwned answers first, without a lock, so a malformed, foreign or missing ID is the same 404 as
// before and never waits. Then one transaction takes the warehouse lock and reads the row AGAIN:
// what findOwned saw may be stale (a concurrent archive or restore), and the archived state, the
// stock check and the update must all be judged on the row as it is under the lock. The same lock
// is taken by stock writes and by the assignment of members, so none of them can run in between.
async function updateWarehouse(ctx, id, body) {
  const { archived, ...fields } = body;
  const found = await findOwned(ctx, "Warehouse", id);

  return inTransaction(async (transaction) => {
    const warehouse = await lockWarehouse(ctx, found.id, transaction);
    if (!warehouse || (warehouse.archivedAt && archived !== false)) throw notFound();
    if (archived === true) await assertNoStock(ctx, warehouse.id, transaction);

    const values = { ...fields };
    if (archived !== undefined) values.archivedAt = archived ? new Date() : null;
    await warehouse.update(values, { transaction }).catch(rethrowDuplicateCode);
    return warehouse;
  });
}

module.exports = { createWarehouse, updateWarehouse };
