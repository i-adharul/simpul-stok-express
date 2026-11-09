const express = require("express");
const authentication = require("../middlewares/authentication");
const { requirePlatformAdmin } = require("../middlewares/authorization");

const router = express.Router();

// Everything under /api/platform is for the Platform admin only. The two guards sit on the prefix,
// so a route added here later (E11-03) cannot forget them: no token is 401, a tenant role is 403,
// both before any data is read. There are no endpoints yet.
router.use("/platform", authentication, requirePlatformAdmin);

module.exports = router;
