const express = require("express");
const auth = require("./auth");
const health = require("./health");
const me = require("./me");
const warehouses = require("./warehouses");

const router = express.Router();

router.use(health);
router.use(auth);
router.use(me);
router.use(warehouses);

module.exports = router;
