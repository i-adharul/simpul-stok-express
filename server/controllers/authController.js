const authService = require("../services/authService");

// Thin on purpose: the input was already validated (req.valid), so this only hands it to the
// service and shapes the reply. Errors are thrown by the service and answered by errorHandler.
async function login(req, res) {
  const result = await authService.login(req.valid.body);
  res.status(200).json(result);
}

module.exports = { login };
