const memberService = require("../services/memberService");

async function list(req, res) {
  res.status(200).json(await memberService.list(req.ctx, req.valid.query));
}

// The member comes from the URL, the caller from req.ctx. The answer has the shape of one list row.
async function update(req, res) {
  res.status(200).json(await memberService.update(req.ctx, req.params.id, req.valid.body));
}

module.exports = { list, update };
