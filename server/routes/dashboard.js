const express = require("express");
const dashboardController = require("../controllers/dashboardController");
const authentication = require("../middlewares/authentication");
const { requireRole } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");

const router = express.Router();

// Each call reads the database and must never be kept by a browser or proxy (docs/04, no cache).
router.use("/dashboard", noStore);

// Every tenant role may read it, as the stock summary: `stock.read` is the action, and which
// warehouses count is decided by ctx.warehouseIds. No query is read, so there is nothing to validate.
router.get("/dashboard", authentication, requireRole("stock.read"), dashboardController.show);

module.exports = router;
