const express = require("express");
const getHealth = require("../controllers/healthController");

const router = express.Router();

// Public on purpose: no token, so a monitor or the deploy script can call it.
router.get("/health", getHealth);

module.exports = router;
