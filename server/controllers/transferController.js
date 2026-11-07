const { forbidden } = require("../helpers/errors");
const { can } = require("../helpers/permissions");
const { tenant } = require("../helpers/tenantScope");
const idempotencyService = require("../services/idempotencyService");
const transferService = require("../services/transferService");

// The role was checked by the route (requireRole). Here the SOURCE warehouse is judged: one 403 for
// a source that is unassigned, archived, foreign or missing (ctx.warehouseIds holds only the
// caller's active ones), so nothing tells those cases apart. The destination is NOT judged here: it
// may be any active warehouse of the organization (BL13), so the service looks it up (404, 409).
// This comes BEFORE run(): the key pre-check answers from a table and must never be reached by
// someone who may not act (ADR 0012). A replay is authorized again against the stored transfer's
// source; a caller who may not act on it gets the same 404 as for a missing transfer. The body of
// both the first answer and a replay comes from getTransfer (stored rows, no balances).
async function create(req, res) {
  const { ctx } = req;
  const input = req.valid.body;
  if (!can(ctx, "stock.transfer", { warehouseId: input.fromWarehouseId })) throw forbidden();

  const { replayed, body } = await idempotencyService.run(
    ctx,
    { key: req.idempotencyKey, endpoint: "POST /api/stock/transfers" },
    {
      work: (transaction) => transferService.transfer(ctx, input, transaction),
      load: (id) => transferService.getTransfer(ctx, id),
      access: (context, transfer) => can(context, "stock.transfer", { warehouseId: transfer.fromWarehouseId }),
    },
  );

  if (replayed) res.set("Idempotency-Replayed", "true");
  res.status(201).json(body);
}

// No input schema: the only input is the ID, and a malformed ID must be 404, not 400 (rule 2). The
// role was checked by the route; the service limits the answer to the caller's warehouses.
async function show(req, res) {
  res.status(200).json(await transferService.getTransferDetail(req.ctx, req.params.id));
}

// Every ACTIVE warehouse of the organization, not only the caller's assigned ones: the destination
// of a transfer may be any of them (BL13), while GET /api/warehouses lists just the assigned ones
// for a Warehouse Admin. Only id, code and name leave the server. The tenant client adds the
// organization filter.
async function destinations(req, res) {
  const rows = await tenant(req.ctx).Warehouse.findAll({
    where: { archivedAt: null },
    attributes: ["id", "code", "name"],
    order: [["code", "ASC"], ["id", "ASC"]],
  });
  res.status(200).json({ items: rows.map(({ id, code, name }) => ({ id, code, name })) });
}

module.exports = { create, show, destinations };
