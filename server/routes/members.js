const express = require("express");
const memberController = require("../controllers/memberController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const validate = require("../middlewares/validate");
const { memberListQuerySchema } = require("../schemas/member.schema");

const router = express.Router();

// Owner only (member.manage): the role is checked before the query is read (rule 2).
router.get(
  "/members",
  authentication,
  requireCan("member.manage"),
  validate({ query: memberListQuerySchema }),
  memberController.list,
);

module.exports = router;
