const express = require("express");
const organizationController = require("../controllers/organizationController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const { updateOrganizationSchema } = require("../schemas/organization.schema");

const router = express.Router();

// The organization of the caller (no ID in the URL). Every tenant role may read it; a Platform admin
// has no organization and gets 403 from the role check.
router.get("/organization", authentication, requireCan("organization.read"), organizationController.show);

// Owner only. Order as everywhere: role (403 before the body is read), subscription (rule 17), validate.
router.patch(
  "/organization",
  authentication,
  requireCan("organization.manage"),
  subscriptionGuard,
  validate({ body: updateOrganizationSchema }),
  organizationController.update,
);

module.exports = router;
