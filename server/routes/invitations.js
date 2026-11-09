const express = require("express");
const invitationController = require("../controllers/invitationController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const { createInvitationSchema } = require("../schemas/invitation.schema");

const router = express.Router();

// A response here can carry a token (the raw one, once), so none of them may be cached.
router.use("/invitations", noStore);

// Owner only (member.manage). Order as everywhere: who are you, may your role do this (403 before the
// body is read, rule 2), subscription check (rule 17), then validate.
router.post(
  "/invitations",
  authentication,
  requireCan("member.manage"),
  subscriptionGuard,
  validate({ body: createInvitationSchema }),
  invitationController.create,
);

module.exports = router;
