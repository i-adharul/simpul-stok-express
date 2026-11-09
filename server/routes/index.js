const express = require("express");
const auth = require("./auth");
const dashboard = require("./dashboard");
const health = require("./health");
const invitations = require("./invitations");
const me = require("./me");
const members = require("./members");
const organization = require("./organization");
const platform = require("./platform");
const products = require("./products");
const stock = require("./stock");
const warehouses = require("./warehouses");

const router = express.Router();

router.use(health);
router.use(auth);
router.use(me);
router.use(members);
router.use(organization);
router.use(invitations);
router.use(warehouses);
router.use(products);
router.use(stock);
router.use(dashboard);
router.use(platform);

module.exports = router;
