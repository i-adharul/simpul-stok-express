const memberService = require("../services/memberService");

async function list(req, res) {
  res.status(200).json(await memberService.list(req.ctx, req.valid.query));
}

module.exports = { list };
