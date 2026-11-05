const { conflict, forbidden, notFound, validationError } = require("../helpers/errors");
const { tenant } = require("../helpers/tenantScope");
const { MAX_QUANTITY } = require("./stockService");
const { lockWarehouse } = require("./warehouseLock");

// Transfer between warehouses (BL13). Business rules only: no HTTP here, and no transaction of its
// own; the idempotency service opens it (rule 6, ADR 0012) and passes it to every function.

const MAX_ITEMS = 50;
const MIN_ITEM_QUANTITY = 1;
const MAX_ITEM_QUANTITY = 1000000;

const problem = (path, message) => ({ source: "body", path, message });

// Rules that need no database. The schema of the endpoint checks the same shape first; the service
// repeats it because it is the one that must never write a wrong transfer, whoever calls it.
// Every problem is collected, so the caller sees them all at once (VALIDATION_ERROR, 400).
function assertTransferInput({ fromWarehouseId, toWarehouseId, items }) {
  const problems = [];
  if (fromWarehouseId === toWarehouseId) problems.push(problem("toWarehouseId", "Gudang tujuan harus berbeda dari gudang asal."));
  if (!Array.isArray(items) || items.length < 1) problems.push(problem("items", "Minimal 1 item."));
  else if (items.length > MAX_ITEMS) problems.push(problem("items", `Maksimal ${MAX_ITEMS} item.`));

  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    if (seen.has(item.productId)) problems.push(problem(`items.${index}.productId`, "Produk tidak boleh muncul dua kali."));
    seen.add(item.productId);
    const { quantity } = item;
    if (!Number.isInteger(quantity) || quantity < MIN_ITEM_QUANTITY || quantity > MAX_ITEM_QUANTITY) {
      problems.push(problem(`items.${index}.quantity`, `Jumlah harus bilangan bulat ${MIN_ITEM_QUANTITY} sampai ${MAX_ITEM_QUANTITY}.`));
    }
  });
  if (problems.length > 0) throw validationError(problems);
}

// The two warehouse rows as the lock returned them (null: missing or of another organization).
// The source was authorized by the controller, so a null source is answered like any source the
// caller may not use (403). A destination the caller cannot see is a 404 (BL13: it may be any
// warehouse of the organization, so it is looked up, not authorized). An archived one is a 409.
function assertWarehousesUsable({ source, destination }) {
  if (!source) throw forbidden();
  if (source.archivedAt) throw conflict("Gudang asal sudah diarsipkan.");
  if (!destination) throw notFound();
  if (destination.archivedAt) throw conflict("Gudang tujuan sudah diarsipkan.");
}

// The items ordered by productId (the order of every lock and write, rule 6), each checked against
// the products of this organization: missing or foreign is a 404 (the same answer for both), an
// archived one is a 409 (BL09: it takes no transfer). The FIRST problem in productId order wins,
// so the answer does not depend on the order the client sent. One query, not one per item.
async function loadTransferItems(ctx, items, transaction) {
  const sorted = [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  const rows = await tenant(ctx).Product.findAll({ where: { id: sorted.map((item) => item.productId) }, transaction });
  const byId = new Map(rows.map((product) => [product.id, product]));
  for (const { productId } of sorted) {
    const product = byId.get(productId);
    if (!product) throw notFound();
    if (product.archivedAt) throw conflict("Produk sudah diarsipkan.");
  }
  return sorted;
}

// The quantity a destination row would hold after the transfer. Above the INTEGER column the
// answer is a 409 chosen here, so the database never raises a numeric-overflow error (ADR 0013).
function destinationQuantity(current, quantity) {
  if (current + quantity > MAX_QUANTITY) throw conflict("Stok melebihi batas yang dapat disimpan.");
  return current + quantity;
}

// Locks the two warehouses ONE AFTER THE OTHER in ascending ID order, whichever is the source
// (rule 7, ADR 0013/0014). Two opposite transfers (A to B and B to A) then both ask for the smaller
// ID first, so one waits for the other instead of each holding one lock and waiting for the second:
// no deadlock. The rows come back as they are once the locks are held, so `archivedAt` is read
// only after nothing can archive the warehouse any more. null means missing or foreign.
async function lockBothWarehouses(ctx, { fromWarehouseId, toWarehouseId }, transaction) {
  const ids = [fromWarehouseId, toWarehouseId].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const rows = new Map();
  for (const id of ids) rows.set(id, await lockWarehouse(ctx, id, transaction));
  return { source: rows.get(fromWarehouseId), destination: rows.get(toWarehouseId) };
}

// Everything a transfer must know before it writes, in the order that keeps it safe: shape (no
// database), both warehouse locks, the state of the warehouses as seen under the locks, then the
// products. Returns the locked rows and the items ordered by productId.
async function prepareTransfer(ctx, input, transaction) {
  assertTransferInput(input);
  const { source, destination } = await lockBothWarehouses(ctx, input, transaction);
  assertWarehousesUsable({ source, destination });
  const items = await loadTransferItems(ctx, input.items, transaction);
  return { source, destination, items };
}

module.exports = {
  MAX_ITEMS,
  assertTransferInput,
  assertWarehousesUsable,
  loadTransferItems,
  destinationQuantity,
  lockBothWarehouses,
  prepareTransfer,
};
