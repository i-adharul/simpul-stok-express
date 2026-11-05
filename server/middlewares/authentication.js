const { unauthenticated } = require("../helpers/errors");
const { verifyToken } = require("../helpers/jwt");
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

  // E2-03 builds req.ctx from this; until then handlers read req.user.
  req.user = user.get({ plain: true });
  return next();
}

module.exports = authentication;
