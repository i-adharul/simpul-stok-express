const warehouseMemberService = require("../services/warehouseMemberService");

// The warehouse comes from the URL and the caller from req.ctx; the service does the rest.
async function list(req, res) {
  res.status(200).json(await warehouseMemberService.getMembers(req.ctx, req.params.id));
}

// The new set of users comes from the validated body; the answer has the shape of the GET.
async function replace(req, res) {
  res.status(200).json(await warehouseMemberService.replaceMembers(req.ctx, req.params.id, req.valid.body.userIds));
}

module.exports = { list, replace };
