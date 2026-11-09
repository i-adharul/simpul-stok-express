const { z } = require("zod");
const { validatePassword } = require("../helpers/password");
const { organizationNameSchema, slugSchema } = require("./organization.schema");

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

// BL04. The owner's email is trimmed and lowercase, like at login. The password rules apply here,
// with the email in hand, so "not equal to the email or the part before the @" is checked too.
// The password itself is never trimmed. Unknown keys are rejected by validate().
const registerOrganizationSchema = z
  .object({
    organizationName: organizationNameSchema,
    slug: slugSchema,
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().min(1).max(254).pipe(z.email()),
    password: z.string().max(128),
  })
  .superRefine((body, ctx) => {
    // Only when the password and the email are usable, so a missing field is reported once.
    if (typeof body.password !== "string" || typeof body.email !== "string") return;
    const check = validatePassword(body.password, { email: body.email });
    if (!check.valid) ctx.addIssue({ code: "custom", path: ["password"], message: check.message });
  });

// BL06. Only the shape is checked here: the invited email is not known until the token is looked up,
// so "the password is not equal to the invited email (or the part before the @)" is applied by the
// service, together with the other password rules (helpers/password.js), once the invitation is found.
// A token of the wrong shape is not a 400: every invalid token is the same 404 (docs/04), so its
// length is only capped. Neither the token nor the password is trimmed.
const acceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(128),
});

module.exports = { loginSchema, changePasswordSchema, registerOrganizationSchema, acceptInviteSchema };
