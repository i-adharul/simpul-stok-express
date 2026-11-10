const memberService = require("../services/memberService");

async function list(req, res) {
  res.status(200).json(await memberService.list(req.ctx, req.valid.query));
}

// The member comes from the URL, the caller from req.ctx. The answer has the shape of one list row.
async function update(req, res) {
  res.status(200).json(await memberService.update(req.ctx, req.params.id, req.valid.body));
}

// The only place the raw reset token leaves the server (BL07): the Owner copies the link from this response.
async function createResetLink(req, res) {
  res.status(201).json(await memberService.createResetLink(req.ctx, req.params.id));
}

module.exports = { list, update, createResetLink };
