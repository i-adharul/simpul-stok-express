const { z } = require("zod");

// Only the shape is checked at login (docs/04): the real test is the password hash. The email
// is trimmed and lowercased here, once, so the service can look it up as it is. The password is
// never trimmed: spaces are part of it.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(128),
});

// Only the shape: the password rules (helpers/password.js) apply to newPassword after the current
// password is verified, so their reason can be the 400 message (docs/04). Neither field is trimmed.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

module.exports = { loginSchema, changePasswordSchema };
