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

const createWarehouse = (organizationId, code = "GD-1", archivedAt = null) =>
  insertReturningId(
    `INSERT INTO "Warehouses" ("organizationId", "code", "name", "archivedAt")
     VALUES (:organizationId, :code, :code, :archivedAt)`,
    { organizationId, code, archivedAt },
  );

const assignWarehouse = (organizationId, userId, warehouseId) =>
  insertReturningId(
    `INSERT INTO "UserWarehouses" ("organizationId", "userId", "warehouseId")
     VALUES (:organizationId, :userId, :warehouseId)`,
    { organizationId, userId, warehouseId },
  );

const createPlan = (name = "Starter") =>
  insertReturningId(
    `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers")
     VALUES (:name, 300000, 2, 100, 3)`,
    { name },
  );

const createSubscription = (organizationId, planId) =>
  insertReturningId(
    `INSERT INTO "Subscriptions" ("organizationId", "planId", "currentPeriodStart", "currentPeriodEnd", "graceUntil")
     VALUES (:organizationId, :planId, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '2026-12-04T00:00:00Z')`,
    { organizationId, planId },
  );

module.exports = {
  insertReturningId,
  createOrganization,
  createUser,
  createWarehouse,
  assignWarehouse,
  createPlan,
  createSubscription,
};
