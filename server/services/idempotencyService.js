const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");

// The row of a key in this organization, or null. (organizationId, key, endpoint) is unique in the
// database (BL14), and tenant(ctx) adds the organization, so another organization's key is never seen.
const findKey = (ctx, key, endpoint) => tenant(ctx).IdempotencyKey.findOne({ where: { key, endpoint } });

// Runs a stock write at most once per (organization, key, endpoint).
//   work(transaction) does the business effect with every query passed `{ transaction }` and
//   returns the ID of the resource it created.
// 1. Pre-check: a key that is already stored means the request was handled, so nothing runs.
// 2. Otherwise ONE transaction runs `work` and writes the key row as its LAST statement, so the
//    effect and its key commit together or not at all. The key row comes last because its
//    resourceId is only known after `work`.
// Resolves to { replayed, resourceId }.
async function run(ctx, { key, endpoint }, { work }) {
  const stored = await findKey(ctx, key, endpoint);
  if (stored) return { replayed: true, resourceId: stored.resourceId };

  const resourceId = await inTransaction(async (transaction) => {
    const id = await work(transaction);
    if (typeof id !== "string") throw new Error("idempotencyService.run: work must return the new resource ID");
    await tenant(ctx).IdempotencyKey.create({ key, endpoint, resourceId: id }, { transaction });
    return id;
  });
  return { replayed: false, resourceId };
}

module.exports = { run };
