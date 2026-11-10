const authService = require("../services/authService");
const { isDemoAccount } = require("../helpers/demoAccounts");

// req.user comes from the authentication middleware and already holds the organization (loaded in
// the same query). Only the documented fields are copied, so nothing else can leak by accident.
function getMe(req, res) {
  const { id, name, email, role, Organization: organization } = req.user;
  res.status(200).json({
    user: { id, name, email, role, isDemo: isDemoAccount(email) }, // BL31: the app shows the "Mode demo" banner
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
        }
      : null,
  });
}

// The user comes from the token (req.user), never from the body. The service answers with a new
// token: the one used for this request stops working as soon as the password changes.
async function changePassword(req, res) {
  const result = await authService.changePassword(req.user.id, req.valid.body);
  res.status(200).json(result);
}

module.exports = { getMe, changePassword };
