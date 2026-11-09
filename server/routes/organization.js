const express = require("express");
const organizationController = require("../controllers/organizationController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");

const router = express.Router();

// The organization of the caller (no ID in the URL). Every tenant role may read it; a Platform admin
// has no organization and gets 403 from the role check.
router.get("/organization", authentication, requireCan("organization.read"), organizationController.show);

module.exports = router;
