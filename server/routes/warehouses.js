const express = require("express");
const warehouseController = require("../controllers/warehouseController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const { createWarehouseSchema, warehouseListQuerySchema } = require("../schemas/warehouse.schema");

const router = express.Router();

router.use("/warehouses", noStore);

// Order on every route: who are you (authentication), may your role do this (requireCan, before
// the input is read, rule 2), is the input valid (validate), then the controller.
router.get(
  "/warehouses",
  authentication,
  requireCan("warehouse.read"),
  validate({ query: warehouseListQuerySchema }),
  warehouseController.list,
);

// No schema: the only input is the ID, and a malformed ID must be 404, not 400 (rule 2).
router.get("/warehouses/:id", authentication, requireCan("warehouse.read"), warehouseController.show);

// Writes add the subscription check (rule 17) after the role check and before validate.
router.post(
  "/warehouses",
  authentication,
  requireCan("warehouse.manage"),
  subscriptionGuard,
  validate({ body: createWarehouseSchema }),
  warehouseController.create,
);

module.exports = router;
