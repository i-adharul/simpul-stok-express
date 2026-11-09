const express = require("express");
const invitationController = require("../controllers/invitationController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const {
  createInvitationSchema,
  invitationIdParamsSchema,
  invitationListQuerySchema,
} = require("../schemas/invitation.schema");

const router = express.Router();

// A response here can carry a token (the raw one, once), so none of them may be cached.
router.use("/invitations", noStore);

// Owner only (member.manage). Order as everywhere: who are you, may your role do this (403 before the
// body is read, rule 2), subscription check (rule 17), then validate.
// Public: the person who opens the link has no account yet (BL06). The token is the proof, and the
// request logger prints the route pattern "/api/invitations/:token", never the token itself.
router.get("/invitations/:token", invitationController.show);

router.get(
  "/invitations",
  authentication,
  requireCan("member.manage"),
  validate({ query: invitationListQuerySchema }),
  invitationController.list,
);

router.post(
  "/invitations",
  authentication,
  requireCan("member.manage"),
  subscriptionGuard,
  validate({ body: createInvitationSchema }),
  invitationController.create,
);

// The ID is only checked to be present: a malformed one is a 404 from findOwned, not a 400 (rule 2).
router.delete(
  "/invitations/:id",
  authentication,
  requireCan("member.manage"),
  subscriptionGuard,
  validate({ params: invitationIdParamsSchema }),
  invitationController.cancel,
);

module.exports = router;
