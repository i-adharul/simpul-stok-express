const organizationService = require("../services/organizationService");

// Thin on purpose: the body was validated (req.valid); the service does the work in one transaction.
async function registerOrganization(req, res) {
  const result = await organizationService.register(req.valid.body);
  res.status(201).json(result);
}

module.exports = { registerOrganization };
