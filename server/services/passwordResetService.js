const { hashPassword } = require("../helpers/bcrypt");
const { notFound, validationError } = require("../helpers/errors");
const { validatePassword } = require("../helpers/password");
const { hashToken } = require("../helpers/token");
const { inTransaction } = require("../helpers/transaction");
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

// The password rules (helpers/password.js) with the email of the member behind the link. Same 400 shape
// as accept-invite: the reason is the message.
function assertPasswordAllowed(password, email) {
  const check = validatePassword(password, { email });
  if (check.valid) return;
  throw validationError([{ source: "body", path: "password", message: check.message }], check.message);
}

// BL07. A usable token is checked first (an invalid one is a 404 whatever the password is), then the
// password rules with the member's email (400). bcrypt runs before the transaction so no connection
// waits for it. Then ONE transaction reads the user again by the token hash with FOR UPDATE and judges
// the link again: of two simultaneous uses of one link the second waits for the first to commit, no
// longer finds the hash (it was cleared) and gets the same 404. The new hash, `passwordChangedAt` (every
// earlier token of that member gets 401, BL01) and the cleared reset columns commit together. No token
// is returned: the member signs in through the login screen.
async function resetPassword({ token, password }) {
  const first = await findUsable(token);
  assertPasswordAllowed(password, first.email);
  const passwordHash = await hashPassword(password);

  await inTransaction(async (transaction) => {
    const user = await findUsable(token, { transaction, lock: transaction.LOCK.UPDATE });
    await user.update(
      { passwordHash, passwordChangedAt: new Date(), resetTokenHash: null, resetExpiresAt: null },
      { transaction },
    );
  });
}

module.exports = { findUsable, showByToken, resetPassword };
