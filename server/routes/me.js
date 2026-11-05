const express = require("express");
const meController = require("../controllers/meController");
const authentication = require("../middlewares/authentication");
const noStore = require("../middlewares/noStore");

const router = express.Router();

// Any logged-in user, in every subscription state (BL23): no subscription check here.
router.get("/me", noStore, authentication, meController.getMe);

module.exports = router;
