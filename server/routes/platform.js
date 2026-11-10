const express = require("express");
const authentication = require("../middlewares/authentication");
const { requirePlatformAdmin } = require("../middlewares/authorization");
const validate = require("../middlewares/validate");
const platformController = require("../controllers/platformController");
const { platformOrganizationListQuerySchema } = require("../schemas/platform.schema");

const router = express.Router();

// Everything under /api/platform is for the Platform admin only. The two guards sit on the prefix,
// so a route added here cannot forget them: no token is 401, a tenant role is 403, both before the
// query is validated or any data is read.
router.use("/platform", authentication, requirePlatformAdmin);

router.get(
  "/platform/organizations",
  validate({ query: platformOrganizationListQuerySchema }),
  platformController.listOrganizations,
);

module.exports = router;
