const { forbidden } = require("../helpers/errors");
const { can } = require("../helpers/permissions");
const { tenant } = require("../helpers/tenantScope");
const idempotencyService = require("../services/idempotencyService");
const stockService = require("../services/stockService");
const stockHistoryService = require("../services/stockHistoryService");
const stockSummaryService = require("../services/stockSummaryService");

// Only immutable data of the movement leaves the server, never the balance, so a replay is equal
// to the first answer (docs/04). `quantity` is the signed change of the movement.
const toReceiveBody = (movement) => ({
  id: movement.id,
  warehouseId: movement.warehouseId,
  productId: movement.productId,
  quantity: movement.quantityDelta,
  createdAt: movement.createdAt,
});

const loadMovement = (ctx) => async (id) => {
  const movement = await tenant(ctx).StockMovement.findByPk(id);
  return movement && toReceiveBody(movement);
};

// The role was checked by the route (requireRole). Here the warehouse is judged: one 403 for a
// warehouse that is unassigned, archived, foreign or missing (ctx.warehouseIds holds only the
// caller's active ones). This comes BEFORE run(): the key pre-check answers from a table and must
// never be reached by someone who may not act (ADR 0012). A replay is authorized again against the
// stored movement's warehouse (`access`): not allowed to see it is the same 404 as a missing one.
async function receive(req, res) {
  const { ctx } = req;
  const input = req.valid.body;
  if (!can(ctx, "stock.receive", { warehouseId: input.warehouseId })) throw forbidden();

  const { replayed, body } = await idempotencyService.run(
    ctx,
    { key: req.idempotencyKey, endpoint: "POST /api/stock/receive" },
    {
      work: (transaction) => stockService.receive(ctx, input, transaction),
      load: loadMovement(ctx),
      access: (context, movement) => can(context, "stock.read", { warehouseId: movement.warehouseId }),
    },
  );

  if (replayed) res.set("Idempotency-Replayed", "true");
  res.status(201).json(body);
}

const toAdjustBody = (movement) => ({ ...toReceiveBody(movement), reason: movement.reason });

const loadAdjustment = (ctx) => async (id) => {
  const movement = await tenant(ctx).StockMovement.findByPk(id);
  return movement && toAdjustBody(movement);
};

// Same shape as receive: the role was checked by the route, the warehouse is judged here BEFORE
// run(), and a replay is authorized again against the stored movement. `quantity` in the answer
// is the signed difference, so a replay equals the first answer whatever the stock is by then.
async function adjust(req, res) {
  const { ctx } = req;
  const input = req.valid.body;
  if (!can(ctx, "stock.adjust", { warehouseId: input.warehouseId })) throw forbidden();

  const { replayed, body } = await idempotencyService.run(
    ctx,
    { key: req.idempotencyKey, endpoint: "POST /api/stock/adjust" },
    {
      work: (transaction) => stockService.adjust(ctx, input, transaction),
      load: loadAdjustment(ctx),
      access: (context, movement) => can(context, "stock.read", { warehouseId: movement.warehouseId }),
    },
  );

  if (replayed) res.set("Idempotency-Replayed", "true");
  res.status(201).json(body);
}

// The role was checked by the route (requireRole); the service authorizes `warehouseId` first.
async function list(req, res) {
  res.status(200).json(await stockSummaryService.listStock(req.ctx, req.valid.query));
}

// The role was checked by the route; the service limits the answer to the caller's warehouses.
async function listMovements(req, res) {
  res.status(200).json(await stockHistoryService.listMovements(req.ctx, req.valid.query));
}

// No input schema: the only input is the ID, and a malformed ID must be 404, not 400 (rule 2).
async function showMovement(req, res) {
  res.status(200).json(await stockHistoryService.getMovement(req.ctx, req.params.id));
}

module.exports = { receive, adjust, list, listMovements, showMovement };
