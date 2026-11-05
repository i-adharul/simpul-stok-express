const express = require("express");
const auth = require("./auth");
const health = require("./health");
const me = require("./me");
const products = require("./products");
const stock = require("./stock");
const warehouses = require("./warehouses");

const router = express.Router();

router.use(health);
router.use(auth);
router.use(me);
router.use(warehouses);
router.use(products);
router.use(stock);

module.exports = router;
