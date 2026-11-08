const dashboardService = require("../services/dashboardService");

// The role was checked by the route (requireRole). There is no input: the answer depends only on
// the context, which holds the organization and the caller's warehouses.
async function show(req, res) {
  res.status(200).json(await dashboardService.getDashboard(req.ctx));
}

module.exports = { show };
