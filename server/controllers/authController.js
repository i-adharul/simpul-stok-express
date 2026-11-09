const authService = require("../services/authService");
const passwordResetService = require("../services/passwordResetService");

// Thin on purpose: the input was already validated (req.valid), so this only hands it to the
// service and shapes the reply. Errors are thrown by the service and answered by errorHandler.
async function login(req, res) {
  const result = await authService.login(req.valid.body);
  res.status(200).json(result);
}

// Public: the token in the body is the proof. 200 like login, so the new member lands on the dashboard.
async function acceptInvite(req, res) {
  const result = await authService.acceptInvite(req.valid.body);
  res.status(200).json(result);
}

// Public: the token in the URL is the proof. Every invalid token is the same 404.
async function showResetPassword(req, res) {
  res.status(200).json(await passwordResetService.showByToken(req.params.token));
}

// The server keeps no session, so there is nothing to revoke: the client deletes its token. The
// answer does not depend on the token, so a client with an expired token can still "log out".
function logout(req, res) {
  res.status(204).end();
}

module.exports = { login, acceptInvite, showResetPassword, logout };
