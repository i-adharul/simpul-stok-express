const express = require("express");
const stockController = require("../controllers/stockController");
const authentication = require("../middlewares/authentication");
const { requireRole } = require("../middlewares/authorization");
const idempotencyKey = require("../middlewares/idempotencyKey");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const { receiveSchema, adjustSchema, stockListQuerySchema, movementListQuerySchema } = require("../schemas/stock.schema");

const router = express.Router();

router.use("/stock", noStore);

// Order on a stock write: who are you (authentication), may your role ever do this (requireRole,
// before the input is read, rule 2), the subscription (rule 17), the Idempotency-Key header (400
// before the body), the body (validate). The warehouse is judged in the controller, once known.
// Every tenant role may read stock; which warehouses they see is decided by ctx.warehouseIds.
router.get(
  "/stock",
  authentication,
  requireRole("stock.read"),
  validate({ query: stockListQuerySchema }),
  stockController.list,
);

// The history. A warehouse outside the caller's reach is an empty list here, not a 403 (docs/04).
router.get(
  "/stock/movements",
  authentication,
  requireRole("history.read"),
  validate({ query: movementListQuerySchema }),
  stockController.listMovements,
);

// No schema: a malformed ID is a 404 from the service, like every ID in a URL (rule 2).
router.get("/stock/movements/:id", authentication, requireRole("history.read"), stockController.showMovement);

router.post(
  "/stock/receive",
  authentication,
  requireRole("stock.receive"),
  subscriptionGuard,
  idempotencyKey,
  validate({ body: receiveSchema }),
  stockController.receive,
);

router.post(
  "/stock/adjust",
  authentication,
  requireRole("stock.adjust"),
  subscriptionGuard,
  idempotencyKey,
  validate({ body: adjustSchema }),
  stockController.adjust,
);

module.exports = router;
