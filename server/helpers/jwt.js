const jwt = require("jsonwebtoken");
const env = require("../config/env");

// The algorithm is fixed on both sides. Without `algorithms` in verify, a token claiming another
// algorithm (or "none") would be judged by what the token says about itself.
const ALGORITHM = "HS256";

// The payload is empty on purpose: jsonwebtoken adds `iat`, and `subject` becomes `sub` and
// `expiresIn` becomes `exp`. The role and the organization are never in the token; the user is
// read from the database on every request (docs/04, Authentication).
function signToken(userId, expiresIn = env.JWT_EXPIRES_IN) {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: userId,
    expiresIn,
  });
}

// Throws JsonWebTokenError / TokenExpiredError, which errorHandler answers with 401 UNAUTHENTICATED.
function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
}

module.exports = { signToken, verifyToken };
