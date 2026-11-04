// Pure helpers, kept apart from setup.js so the guard itself can be tested.

function databaseName(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

// Tests empty their tables, so a wrong database here would destroy real data.
// The message names the database but never the full URL, which holds the password.
function assertTestDatabase(url) {
  const name = databaseName(url);
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests: database "${name}" does not end in "_test". ` +
        "Point TEST_DATABASE_URL at a dedicated test database.",
    );
  }
  return name;
}

module.exports = { assertTestDatabase, databaseName };
