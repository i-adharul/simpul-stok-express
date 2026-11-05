const express = require("express");
const authController = require("../controllers/authController");
const noStore = require("../middlewares/noStore");
const validate = require("../middlewares/validate");
const { loginSchema } = require("../schemas/auth.schema");

const router = express.Router();

router.use("/auth", noStore);

// Public: no token yet. No subscription check either (login must work in every state, BL23).
router.post("/auth/login", validate({ body: loginSchema }), authController.login);

module.exports = router;
