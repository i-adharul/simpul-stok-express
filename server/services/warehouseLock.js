const { tenant } = require("../helpers/tenantScope");

// The serialization point of every stock write (ADR 0013): the warehouse row is read with
// SELECT ... FOR UPDATE inside the caller's transaction, so two stock writers of one warehouse run
// one after the other. The lock is held until the transaction commits or rolls back.
//
// FOR UPDATE rather than FOR NO KEY UPDATE: Postgres also offers the weaker NO KEY UPDATE, which
// still queues writers against each other but lets another transaction insert a row that merely
// references the warehouse (a foreign-key check only takes KEY SHARE). Here that gap buys nothing:
// the stock writes that must queue are the ones that take this lock, and FOR UPDATE is the mode
// the rest of the code (the warehouse assignment) already uses and the one the docs describe. The
// archive of a warehouse is an UPDATE that takes NO KEY UPDATE implicitly, so it also waits for
// (and blocks) a holder of either mode.
//
// Returns the warehouse row of the caller's organization, or null when there is none (missing or
// of another organization: tenant(ctx) filters by organization). The caller decides what null and
// an archived row mean. Without a transaction the lock would be released at once, so that is a bug.
async function lockWarehouse(ctx, warehouseId, transaction) {
  if (!transaction) throw new Error("lockWarehouse must run inside a transaction");
  return tenant(ctx).Warehouse.findOne({
    where: { id: warehouseId },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
}

module.exports = { lockWarehouse };
