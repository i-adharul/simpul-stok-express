// Small helpers that insert the parent rows a schema test needs. They use raw SQL on purpose:
// the tests prove the database rules, so they must not depend on the models.
const { getSequelize } = require("./db");

async function insertReturningId(sql, replacements) {
  const [rows] = await getSequelize().query(`${sql} RETURNING "id"`, {
    replacements,
  });
  return rows[0].id;
}

const createOrganization = (slug = "tokomaju") =>
  insertReturningId(
    `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', :slug)`,
    { slug },
  );

const createUser = (
  organizationId,
  email = "budi@example.com",
  role = "OWNER",
) =>
  insertReturningId(
    `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role")
     VALUES (:organizationId, :email, 'Budi', 'hash', CAST(:role AS "enum_Users_role"))`,
    { organizationId, email, role },
  );

module.exports = { insertReturningId, createOrganization, createUser };
