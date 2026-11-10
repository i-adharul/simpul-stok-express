const platformService = require("../services/platformService");

async function listOrganizations(req, res) {
  res.status(200).json(await platformService.listOrganizations(req.valid.query));
}

module.exports = { listOrganizations };
