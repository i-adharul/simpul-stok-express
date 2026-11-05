// Inserts users with a real bcrypt hash, for tests of login and sessions. Raw SQL, like
// factories.js, so the tests do not depend on the models they check.
const { hashPassword } = require("../../helpers/bcrypt");
const { getSequelize } = require("./db");
const { createOrganization } = require("./factories");

const hashes = new Map();

// bcrypt at cost 12 takes a few hundred milliseconds; one hash per password per test file is enough.
async function hashOnce(password) {
  if (!hashes.has(password)) hashes.set(password, await hashPassword(password));
  return hashes.get(password);
}

// Creates an organization (unless the role is PLATFORM_ADMIN) and one user. Returns the user row.
async function createAccount({
  email = "owner@example.com",
  password = "Gula-Kopi-2026",
  name = "Budi Owner",
  role = "OWNER",
  isActive = true,
  organizationId,
  passwordChangedAt = null,
} = {}) {
  const orgId =
    role === "PLATFORM_ADMIN" ? null : (organizationId ?? (await createOrganization()));
  const [rows] = await getSequelize().query(
    `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role", "isActive", "passwordChangedAt")
     VALUES (:orgId, :email, :name, :hash, CAST(:role AS "enum_Users_role"), :isActive, :passwordChangedAt)
     RETURNING "id", "email", "name", "role", "organizationId"`,
    {
      replacements: {
        orgId,
        email,
        name,
        hash: await hashOnce(password),
        role,
        isActive,
        passwordChangedAt,
      },
    },
  );
  return { ...rows[0], password };
}

const readUser = async (id) =>
  (await getSequelize().query('SELECT * FROM "Users" WHERE "id" = :id', { replacements: { id } }))[0][0];

module.exports = { createAccount, readUser };
