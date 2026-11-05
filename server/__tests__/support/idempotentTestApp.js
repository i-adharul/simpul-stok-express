// A test-only endpoint built the way a stock endpoint is built (E4-02): authentication, the role
// check, the key header, then the idempotency service. Its effect is one Warehouse row.
// A body with code "FAIL" writes the row and then fails, to prove a failed request stores no key.
const express = require("express");
const authentication = require("../../middlewares/authentication");
const { requireCan } = require("../../middlewares/authorization");
const idempotencyKey = require("../../middlewares/idempotencyKey");
const { errorHandler } = require("../../middlewares/errorHandler");
const { conflict } = require("../../helpers/errors");
const { tenant } = require("../../helpers/tenantScope");
const idempotencyService = require("../../services/idempotencyService");

const ENDPOINT = "POST /test/warehouses";

function buildIdempotentTestApp() {
  const app = express();
  app.use(express.json());
  app.post("/test/warehouses", authentication, requireCan("warehouse.manage"), idempotencyKey, async (req, res) => {
    const { ctx } = req;
    const { replayed, body } = await idempotencyService.run(
      ctx,
      { key: req.idempotencyKey, endpoint: ENDPOINT },
      {
        work: async (transaction) => {
          const row = await tenant(ctx).Warehouse.create({ code: req.body.code, name: req.body.code }, { transaction });
          if (req.body.code === "FAIL") throw conflict();
          return row.id;
        },
        load: async (id) => {
          const row = await tenant(ctx).Warehouse.findByPk(id);
          return row && { id: row.id, code: row.code };
        },
        access: () => true,
      },
    );
    if (replayed) res.set("Idempotency-Replayed", "true");
    res.status(201).json(body);
  });
  app.use(errorHandler);
  return app;
}

module.exports = { buildIdempotentTestApp, ENDPOINT };
