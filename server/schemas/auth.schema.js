const { z } = require("zod");

// Only the shape is checked at login (docs/04): the real test is the password hash. The email
// is trimmed and lowercased here, once, so the service can look it up as it is. The password is
// never trimmed: spaces are part of it.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(128),
});

module.exports = { loginSchema };
