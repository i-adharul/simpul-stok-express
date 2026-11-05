const { unauthenticated } = require("../helpers/errors");
const { verifyToken } = require("../helpers/jwt");
const { buildContext } = require("../helpers/requestContext");
const { findUserById } = require("../helpers/userAccess");

const BEARER = /^Bearer ([^\s]+)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the token string, or null when the header is missing or is not "Bearer <token>".
function readBearerToken(req) {
  const match = BEARER.exec(req.get("Authorization") ?? "");
  return match ? match[1] : null;
}

// Returns the payload of a good token, or null. Bad signature, wrong algorithm, expiry, damage and
// a missing or non-UUID subject all look the same to the caller: no session.
function readPayload(token) {
  try {
    const payload = verifyToken(token);
    return typeof payload.sub === "string" && UUID.test(payload.sub) ? payload : null;
  } catch {
    return null;
  }
}

// A token is refused when it was issued before the last password change (BL01), so changing the
// password signs out every other device. Both sides are compared in whole seconds because `iat`
// has no fraction. KNOWN LIMIT: a token issued in the same second as the change is still accepted.
// A token without a numeric `iat` cannot be placed in time, so it is refused when a change exists.
function issuedBeforePasswordChange(iat, passwordChangedAt) {
  if (!passwordChangedAt) return false;
  if (typeof iat !== "number") return true;
  return iat < Math.floor(new Date(passwordChangedAt).getTime() / 1000);
}

// Protected routes start here. The token proves who the caller is; everything else (role,
// organization, status) is read from the database on every request, never from the token, so a
// deactivation or a role change takes effect at once (BL01, BL07). Every failure is the same
// 401 UNAUTHENTICATED, so the answer does not say which check failed.
async function authentication(req, res, next) {
  const token = readBearerToken(req);
  const payload = token && readPayload(token);
  if (!payload) return next(unauthenticated());

  const user = await findUserById(payload.sub);
  if (!user || !user.isActive) return next(unauthenticated());
  if (issuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) {
    return next(unauthenticated());
  }

  // req.ctx is what every lower layer receives (organizationId comes from here and nowhere else).
  // req.user stays for the /me handlers that need the profile and the organization record.
  req.user = user.get({ plain: true });
  req.ctx = await buildContext(req.user);
  return next();
}

module.exports = authentication;
module.exports.issuedBeforePasswordChange = issuedBeforePasswordChange;
