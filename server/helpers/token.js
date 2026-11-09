const crypto = require("crypto");

// Random single-use tokens for invitation links and (later) password reset links (BL05, BL07).
// The raw token exists only in memory and in the one response that hands it to the Owner; the
// database keeps only its hash, so a leaked database cannot be used to accept an invitation.

// 32 random bytes from the operating system, written as 43 URL-safe characters (base64url, no padding).
const generateToken = () => crypto.randomBytes(32).toString("base64url");

// SHA-256 as 64 hex characters. A fast hash is right here: the token is 256 random bits, so there is
// nothing to guess and nothing to slow down (unlike a password, which needs bcrypt).
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

module.exports = { generateToken, hashToken };
