const express = require("express");
const meController = require("../controllers/meController");
const authentication = require("../middlewares/authentication");
const noStore = require("../middlewares/noStore");
const validate = require("../middlewares/validate");
const { changePasswordSchema } = require("../schemas/auth.schema");

const router = express.Router();

router.use("/me", noStore);

// Any logged-in user, in every subscription state (BL23): no subscription check on these routes,
// not even when subscriptionGuard exists (E2-07), because a locked-out user must still be able to
// change a password.
router.get("/me", authentication, meController.getMe);

// Authentication first: a caller without a session gets 401 before the body is looked at.
router.patch(
  "/me/password",
  authentication,
  validate({ body: changePasswordSchema }),
  meController.changePassword,
);

module.exports = router;
