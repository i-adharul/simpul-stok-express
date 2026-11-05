const { notFound } = require("../helpers/errors");
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
// Resolves to { replayed, resourceId } (this is `execute`; `run` below turns it into the response).
async function execute(ctx, { key, endpoint }, work) {
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

// Turns the ID into the response body. The first call and a replay both go through load(), so the
// two cannot differ in shape. Only a replay is authorized again: the first call was authorized by
// the handler before run() was called, and a replay is judged against the stored resource itself
// (its warehouse may be one this caller no longer reaches). A resource the caller may not see, or
// that is gone, is the same 404 as a missing one (rule 2), never 403.
async function respond(ctx, { replayed, resourceId }, { load, access }) {
  const body = await load(resourceId);
  if (!body) throw notFound();
  if (replayed && !(await access(ctx, body))) throw notFound();
  return { replayed, body };
}

// The door for stock writes. The caller must have authorized the user (role and warehouse) BEFORE
// calling this: the pre-check below answers from the table, so a user who may not act must never
// get that far. Resolves to { replayed, body }; the controller sends the body with the status and,
// when `replayed`, the header Idempotency-Replayed: true.
//   work(transaction) -> resource ID; load(resourceId) -> body; access(ctx, body) -> boolean.
async function run(ctx, target, { work, load, access }) {
  return respond(ctx, await execute(ctx, target, work), { load, access });
}

module.exports = { run };
