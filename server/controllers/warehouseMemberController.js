const warehouseMemberService = require("../services/warehouseMemberService");

// The warehouse comes from the URL and the caller from req.ctx; the service does the rest.
async function list(req, res) {
  res.status(200).json(await warehouseMemberService.getMembers(req.ctx, req.params.id));
}

module.exports = { list };
