const express = require("express");
const auth = require("./auth");
const health = require("./health");

const router = express.Router();

router.use(health);
router.use(auth);

module.exports = router;
