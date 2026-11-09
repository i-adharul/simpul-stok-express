const organizationService = require("../services/organizationService");

// Thin on purpose: the body was validated (req.valid); the service does the work in one transaction.
async function registerOrganization(req, res) {
  const result = await organizationService.register(req.valid.body);
  res.status(201).json(result);
}

// No ID anywhere: the organization is the caller's own, taken from req.ctx (rule 1).
async function show(req, res) {
  const organization = await organizationService.getOrganization(req.ctx);
  res.status(200).json({ organization });
}

async function update(req, res) {
  const organization = await organizationService.updateOrganization(req.ctx, req.valid.body);
  res.status(200).json({ organization });
}

module.exports = { registerOrganization, show, update };
