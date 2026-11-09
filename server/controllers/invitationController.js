const invitationService = require("../services/invitationService");

// The only place the raw token leaves the server (BL05): the Owner copies the link from this one
// response. The route sets `Cache-Control: no-store` so no browser or proxy keeps it.
async function create(req, res) {
  const { invitation, token } = await invitationService.create(req.ctx, req.valid.body);
  res.status(201).json({ invitation, token });
}

module.exports = { create };
