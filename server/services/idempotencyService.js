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
// 3. If the transaction fails, the key table is checked once more (answerTwinOrThrow).
// Resolves to { replayed, resourceId }.
async function run(ctx, { key, endpoint }, { work }) {
  const stored = await findKey(ctx, key, endpoint);
  if (stored) return { replayed: true, resourceId: stored.resourceId };

  try {
    const resourceId = await inTransaction(async (transaction) => {
      const id = await work(transaction);
      if (typeof id !== "string") throw new Error("idempotencyService.run: work must return the new resource ID");
      await tenant(ctx).IdempotencyKey.create({ key, endpoint, resourceId: id }, { transaction });
      return id;
    });
    return { replayed: false, resourceId };
  } catch (error) {
    return answerTwinOrThrow(ctx, { key, endpoint }, error);
  }
}

// After ANY failure, look at the key table again (outside the rolled-back transaction). A key that
// exists now means a twin request with the same key committed first. That covers the unique-key
// violation, but also a `work` that failed on its business rule only because the twin's effect was
// already there (for example the last units of stock gone). Both are a replay, not an error. No key
// means a genuine failure: the original error is thrown unchanged and nothing is stored, so the same
// key can be sent again. A failing lookup must not hide the original error.
async function answerTwinOrThrow(ctx, { key, endpoint }, error) {
  const twin = await findKey(ctx, key, endpoint).catch(() => null);
  if (!twin) throw error;
  return { replayed: true, resourceId: twin.resourceId };
}

module.exports = { run };
