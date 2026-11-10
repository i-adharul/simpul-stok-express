const express = require("express");
const memberController = require("../controllers/memberController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const {
  memberIdParamsSchema,
  memberListQuerySchema,
  resetLinkBodySchema,
  updateMemberSchema,
} = require("../schemas/member.schema");

const router = express.Router();

// Owner only (member.manage): the role is checked before the query is read (rule 2).
router.get(
  "/members",
  authentication,
  requireCan("member.manage"),
  validate({ query: memberListQuerySchema }),
  memberController.list,
);

// The ID is not validated here (a malformed ID is a 404 from findOwned, rule 2); only the body is. The
// role is checked first (403 before anything else), then the subscription (rule 17), then validate.
router.patch(
  "/members/:id",
  authentication,
  requireCan("member.manage"),
  subscriptionGuard,
  validate({ body: updateMemberSchema }),
  memberController.update,
);

// The answer holds the raw reset token (once), so it must never be cached. Same order as above: role (403
// first), subscription (rule 17), then validate.
router.post(
  "/members/:id/reset-link",
  noStore,
  authentication,
  requireCan("member.manage"),
  subscriptionGuard,
  validate({ params: memberIdParamsSchema, body: resetLinkBodySchema }),
  memberController.createResetLink,
);

module.exports = router;
