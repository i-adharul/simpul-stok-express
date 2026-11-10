const env = require("../config/env");
const { demoAccountProtected } = require("./errors");

// The demo accounts (BL31, ADR 0016): the three emails of the configuration, and only while DEMO_MODE is
// on. With the mode off nobody is a demo account, so a real member whose email happens to be in a
// leftover variable is not locked. `env` is read on every call, like the demoMode middleware. The
// platform admin is never in the list.
const demoEmails = () => (env.DEMO_MODE ? [env.DEMO_OWNER_EMAIL, env.DEMO_ADMIN_EMAIL, env.DEMO_VIEWER_EMAIL].filter(Boolean) : []);

// `email` is stored in lowercase; the configured emails are lowercase too (config/envSchema.js).
const isDemoAccount = (email) => typeof email === "string" && demoEmails().includes(email.toLowerCase());

// A shared account that every visitor uses must stay as the demo made it: no new password (it signs
// every other session out), no reset link, no deactivation, no role change. 403 DEMO_ACCOUNT_PROTECTED,
// whoever the caller is, the demo Owner included. `user` only needs an `email`.
function assertNotDemoAccount(user) {
  if (isDemoAccount(user.email)) throw demoAccountProtected();
}

module.exports = { demoEmails, isDemoAccount, assertNotDemoAccount };
