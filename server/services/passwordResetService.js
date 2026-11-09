const { notFound } = require("../helpers/errors");
const { hashToken } = require("../helpers/token");
const { findUserByResetTokenHash } = require("../helpers/userAccess");

// BL07, the public half of the password reset: what the person who opens `/reset/<token>` needs. The
// service knows nothing about HTTP.

// A token has exactly the shape generateToken() makes (43 base64url characters). Anything else cannot
// match a hash, so it is refused before hashing.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// The user behind a raw reset token, if the link can still be used: the hash matches, it has not
// expired and the user is still active (a member deactivated after the link was made cannot use it).
// Malformed, unknown, replaced, used, expired and inactive are ONE and the same 404 with the same body,
// so the answer never says which of them it was. Not tenant-scoped: no session exists yet.
async function findUsable(token, options = {}) {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw notFound();
  const user = await findUserByResetTokenHash(hashToken(token), options);
  if (!user || !user.isActive || !user.resetExpiresAt || user.resetExpiresAt <= new Date()) throw notFound();
  return user;
}

// Only the email: the reset view shows it read-only. Nothing else about the member leaves here.
async function showByToken(token) {
  const user = await findUsable(token);
  return { email: user.email };
}

module.exports = { findUsable, showByToken };
