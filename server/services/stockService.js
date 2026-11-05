const { conflict, forbidden } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");
const { lockWarehouse } = require("./warehouseLock");

// Stock changes (BL11, BL12, ...). Business rules only: no HTTP here, and no transaction of its own.
// Every function takes the transaction that the idempotency service opened (rule 6) and passes it
// to every query it makes; the caller has already checked that the user may act on the warehouse.

// The largest value of the INTEGER column. A receipt that would pass it is a 409 chosen here, so
// the database never has to raise a numeric-overflow error.
const MAX_QUANTITY = 2147483647;

// The warehouse row, locked, and checked to still be active. The lock comes FIRST in every stock
// write (rule 7, ADR 0013): from here on no other stock writer of this warehouse runs, and an
// archive of the warehouse waits for this transaction. A warehouse that is archived by now (it was
// active when the controller authorized the request) is a 409; one that is gone for this
// organization is answered like any warehouse the caller may not use.
async function lockActiveWarehouse(ctx, warehouseId, transaction) {
  const warehouse = await lockWarehouse(ctx, warehouseId, transaction);
  if (!warehouse) throw forbidden();
  if (warehouse.archivedAt) throw conflict("Gudang sudah diarsipkan.");
  return warehouse;
}

// The product of this organization (404 when it is foreign or missing: findOwned) that is not
// archived (409): an archived product takes no new stock (BL11).
async function findActiveProduct(ctx, productId, transaction) {
  const product = await findOwned(ctx, "Product", productId, { transaction });
  if (product.archivedAt) throw conflict("Produk sudah diarsipkan.");
  return product;
}

// Adds `quantity` to the stock row of the pair and creates the row when it is missing. A plain
// read-then-write is safe here because the warehouse lock is held: nobody else changes this row
// meanwhile. The limit is checked before the write, so the answer is a 409, not a database error.
async function addToLevel(ctx, { warehouseId, productId, quantity }, transaction) {
  const levels = tenant(ctx).StockLevel;
  const level = await levels.findOne({ where: { warehouseId, productId }, transaction });
  const current = level ? level.quantity : 0;
  if (current + quantity > MAX_QUANTITY) throw conflict("Stok melebihi batas yang dapat disimpan.");
  if (level) await level.update({ quantity: current + quantity }, { transaction });
  else await levels.create({ warehouseId, productId, quantity }, { transaction });
}

// BL11: lock the warehouse, check warehouse and product, add to the stock row, write the RECEIVE
// movement. Returns the ID of the movement: that is the resource the idempotency key points to,
// and the response is built from it, never from the balance.
async function receive(ctx, { warehouseId, productId, quantity, note }, transaction) {
  await lockActiveWarehouse(ctx, warehouseId, transaction);
  const product = await findActiveProduct(ctx, productId, transaction);
  await addToLevel(ctx, { warehouseId, productId: product.id, quantity }, transaction);
  const movement = await tenant(ctx).StockMovement.create(
    { warehouseId, productId: product.id, quantityDelta: quantity, type: "RECEIVE", note: note ?? null, createdById: ctx.userId },
    { transaction },
  );
  return movement.id;
}

module.exports = { receive, MAX_QUANTITY };
