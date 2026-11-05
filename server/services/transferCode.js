const { tenant } = require("../helpers/tenantScope");

// The document number of a transfer: MT-0001, MT-0002, ... sequential per organization (BL13).
//
// Design (ADR 0014): the number is "how many transfers this organization already has, plus one",
// read inside the transaction of the transfer, and the unique index (organizationId, code) is the
// only thing that guarantees no two transfers share a number. There is NO counter row and no lock
// that every transfer of an organization must take: that would make all transfers of a tenant
// queue on one row, which the spec forbids. Two transfers that touch different warehouses can read
// the same count at the same time; the second insert then breaks the unique index and the caller
// retries with a fresh count (see createWithCode, added with the transfer row, step 5).
//
// A count is a valid sequence because a transfer is never deleted or renumbered (rule 10: it is
// immutable), so the highest number always equals the number of rows.

const CODE_PREFIX = "MT-";

// Four digits at least; a fifth digit appears naturally after MT-9999 (the column holds 20 characters).
const formatTransferCode = (sequence) => `${CODE_PREFIX}${String(sequence).padStart(4, "0")}`;

// The next free code as this transaction sees it. Not a reservation: only the unique index is.
async function nextTransferCode(ctx, transaction) {
  const existing = await tenant(ctx).StockTransfer.count({ transaction });
  return formatTransferCode(existing + 1);
}

module.exports = { CODE_PREFIX, formatTransferCode, nextTransferCode };
