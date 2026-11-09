const invitationService = require("../services/invitationService");

// The only place the raw token leaves the server (BL05): the Owner copies the link from this one
// response. The route sets `Cache-Control: no-store` so no browser or proxy keeps it.
async function create(req, res) {
  const { invitation, token } = await invitationService.create(req.ctx, req.valid.body);
  res.status(201).json({ invitation, token });
}

async function list(req, res) {
  res.status(200).json(await invitationService.list(req.ctx, req.valid.query));
}

async function cancel(req, res) {
  await invitationService.cancel(req.ctx, req.params.id);
  res.status(204).end();
}

// Public (no session): the token in the URL is the proof. Every invalid token is the same 404.
async function show(req, res) {
  res.status(200).json(await invitationService.showByToken(req.params.token));
}

module.exports = { create, list, cancel, show };
