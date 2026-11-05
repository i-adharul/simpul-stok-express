const express = require("express");
const health = require("./health");

const router = express.Router();

router.use(health);

module.exports = router;
