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

const createPlan = (name = "Starter", { maxWarehouses = 2, maxProducts = 100, maxMembers = 3 } = {}) =>
  insertReturningId(
    `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers")
     VALUES (:name, 300000, :maxWarehouses, :maxProducts, :maxMembers)`,
    { name, maxWarehouses, maxProducts, maxMembers },
  );

const createSubscription = (organizationId, planId) =>
  insertReturningId(
    `INSERT INTO "Subscriptions" ("organizationId", "planId", "currentPeriodStart", "currentPeriodEnd", "graceUntil")
     VALUES (:organizationId, :planId, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '2026-12-04T00:00:00Z')`,
    { organizationId, planId },
  );

const createProduct = (organizationId, sku = "SKU-1", unit = "pcs") =>
  insertReturningId(
    `INSERT INTO "Products" ("organizationId", "sku", "name", "unit")
     VALUES (:organizationId, :sku, :sku, :unit)`,
    { organizationId, sku, unit },
  );

const createStockLevel = (organizationId, warehouseId, productId, quantity) =>
  insertReturningId(
    `INSERT INTO "StockLevels" ("organizationId", "warehouseId", "productId", "quantity")
     VALUES (:organizationId, :warehouseId, :productId, :quantity)`,
    { organizationId, warehouseId, productId, quantity },
  );

// The world of the cross-tenant harness: two organizations (A is the caller, B is the "other
// tenant"), one user per role in each, ready-to-use tokens, and builders that make rows for either
// organization. Rows are raw SQL like the other factories, so the harness does not depend on the
// code it checks. Call it once per test, after the tables were cleared.
const ROLES_IN_ORGANIZATION = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"];

async function createWorld() {
  // Required here, not at the top: accounts.js itself requires this file.
  const { createAccount } = require("./accounts");
  const { signToken } = require("../../helpers/jwt");

  const organizations = {
    A: await createOrganization("tokoa"),
    B: await createOrganization("tokob"),
  };
  // Both organizations are on a plan with room to spare, so tests of other features can create as many
  // warehouses, products and members as they need (plan limits, BL20, are tested with their own plans).
  const roomy = await createPlan("Roomy", { maxWarehouses: 1000, maxProducts: 100000, maxMembers: 1000 });
  await createSubscription(organizations.A, roomy);
  await createSubscription(organizations.B, roomy);

  const withToken = (user) => ({ ...user, token: signToken(user.id), authorization: `Bearer ${signToken(user.id)}` });

  const users = { A: {}, B: {} };
  for (const key of ["A", "B"]) {
    for (const role of ROLES_IN_ORGANIZATION) {
      users[key][role] = withToken(
        await createAccount({
          email: `${role.toLowerCase()}-${key.toLowerCase()}@example.com`,
          name: `${role} ${key}`,
          role,
          organizationId: organizations[key],
        }),
      );
    }
  }
  const platformAdmin = withToken(
    await createAccount({ email: "admin@example.com", name: "Admin", role: "PLATFORM_ADMIN" }),
  );

  let counter = 0;
  const next = () => String(++counter).padStart(3, "0");
  return {
    organizations,
    users,
    platformAdmin,
    // organization is "A" or "B"
    createWarehouse: (organization, code = `GD-${next()}`) => createWarehouse(organizations[organization], code),
    createProduct: (organization, sku = `SKU-${next()}`) => createProduct(organizations[organization], sku),
  };
}

module.exports = {
  ROLES_IN_ORGANIZATION,
  createWorld,
  createProduct,
  insertReturningId,
  createOrganization,
  createUser,
  createWarehouse,
  assignWarehouse,
  createPlan,
  createSubscription,
  createStockLevel,
};
