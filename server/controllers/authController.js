const authService = require("../services/authService");

// Thin on purpose: the input was already validated (req.valid), so this only hands it to the
// service and shapes the reply. Errors are thrown by the service and answered by errorHandler.
async function login(req, res) {
  const result = await authService.login(req.valid.body);
  res.status(200).json(result);
}

// The server keeps no session, so there is nothing to revoke: the client deletes its token. The
// answer does not depend on the token, so a client with an expired token can still "log out".
function logout(req, res) {
  res.status(204).end();
}

module.exports = { login, logout };
