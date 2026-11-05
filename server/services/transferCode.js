const { UniqueConstraintError } = require("sequelize");
const { conflict } = require("../helpers/errors");
const { inSavepoint } = require("../helpers/transaction");
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

// The retry rules (BL13): after a collision the call is repeated with a fresh count, at most 5
// times, each time after a random pause of up to 30 ms so two colliding transfers do not collide
// again in step. Then the answer is a 409 the client may simply send again.
const MAX_CODE_RETRIES = 5;
const MAX_DELAY_MS = 30;
const CODE_CONSTRAINT = "StockTransfers_organizationId_code_key";
const TOO_MANY = "Terlalu banyak mutasi bersamaan, coba lagi.";

const randomDelay = () => new Promise((resolve) => setTimeout(resolve, Math.random() * MAX_DELAY_MS));

// Only a break of the (organizationId, code) unique index is a collision. Any other error (a
// foreign key, a CHECK, a lost connection) is a real failure and is thrown unchanged.
const isCodeCollision = (error) => error instanceof UniqueConstraintError && error.parent?.constraint === CODE_CONSTRAINT;

// Inserts the StockTransfer row with the next code. ONLY this insert sits inside a savepoint: a
// collision rolls back to the savepoint, so the warehouse locks, the stock changes already made and
// the rest of the transaction survive, and just the insert is tried again. `wait` is a parameter so
// a test can count the pauses instead of sleeping.
async function createWithCode(ctx, values, transaction, { wait = randomDelay, maxRetries = MAX_CODE_RETRIES } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const code = await nextTransferCode(ctx, transaction);
    try {
      return await inSavepoint(transaction, (savepoint) => tenant(ctx).StockTransfer.create({ ...values, code }, { transaction: savepoint }));
    } catch (error) {
      if (!isCodeCollision(error)) throw error;
      if (attempt >= maxRetries) throw conflict(TOO_MANY);
      await wait();
    }
  }
}

module.exports = { CODE_PREFIX, MAX_CODE_RETRIES, MAX_DELAY_MS, formatTransferCode, nextTransferCode, createWithCode };
