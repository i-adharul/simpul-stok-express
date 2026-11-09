const express = require("express");
const authController = require("../controllers/authController");
const organizationController = require("../controllers/organizationController");
const noStore = require("../middlewares/noStore");
const validate = require("../middlewares/validate");
const { loginSchema, registerOrganizationSchema } = require("../schemas/auth.schema");

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

// Public and without a schema: it reads no input at all (allowed in the write-route static test).
router.post("/auth/logout", authController.logout);

module.exports = router;
