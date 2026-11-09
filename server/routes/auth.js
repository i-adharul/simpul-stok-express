const express = require("express");
const authController = require("../controllers/authController");
const organizationController = require("../controllers/organizationController");
const noStore = require("../middlewares/noStore");
const validate = require("../middlewares/validate");
const { acceptInviteSchema, loginSchema, registerOrganizationSchema } = require("../schemas/auth.schema");

const router = express.Router();

router.use("/auth", noStore);

// Public: no token yet. No subscription check either (login must work in every state, BL23).
router.post("/auth/login", validate({ body: loginSchema }), authController.login);

// Public: no organization exists yet (BL04). No subscription check either: the organization is created
// here, so there is nothing to check (and a new customer must always be able to sign up).
router.post(
  "/auth/register-organization",
  validate({ body: registerOrganizationSchema }),
  organizationController.registerOrganization,
);

// Public: the person has no account yet, the token in the body is the proof (BL06). No subscription
// check: the invitation row says which organization it is, and the guard needs a session.
router.post("/auth/accept-invite", validate({ body: acceptInviteSchema }), authController.acceptInvite);

// Public: the token in the URL is the proof (BL07). A read, so no subscription check. The request logger
// prints the route pattern "/api/auth/reset-password/:token", never the token itself.
router.get("/auth/reset-password/:token", authController.showResetPassword);

// Public and without a schema: it reads no input at all (allowed in the write-route static test).
router.post("/auth/logout", authController.logout);

module.exports = router;
