// Which connection the demo reset script uses (ADR 0017). Pure on purpose: it takes plain values, so
// tests do not touch process.env.
//
// The reset needs TRUNCATE, which the application role does not have (ADR 0007), so it connects with
// its own role through DEMO_RESET_DATABASE_URL. In production that URL is required, and it must not
// be the application's own user: a mistake there would give the API's credentials the power to empty
// the history. Only user names are compared and printed; a URL holds a password.

function userOf(url) {
  return decodeURIComponent(new URL(url).username);
}

// Returns the reset URL, or null when the script should use the database that NODE_ENV picks
// (local development and tests).
function resolveResetConnection({ nodeEnv, resetUrl, appUrl }) {
  if (!resetUrl) {
    if (nodeEnv === "production") {
      throw new Error("Refusing to reset: DEMO_RESET_DATABASE_URL is required in production (the application role cannot TRUNCATE).");
    }
    return null;
  }
  if (userOf(resetUrl) === userOf(appUrl)) {
    throw new Error("Refusing to reset: DEMO_RESET_DATABASE_URL uses the same database user as DATABASE_URL. Use the separate reset role.");
  }
  return resetUrl;
}

module.exports = { resolveResetConnection };
