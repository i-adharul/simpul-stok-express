"use strict";

const crypto = require("crypto");
const { assertSeedAllowed } = require("../helpers/seedGuard");
const { buildDemoData } = require("../helpers/demoData");

// Demo stock for the organization of the base seed ("Toko Maju"): 3 warehouses, 50 products and
// about three weeks of history (helpers/demoData.js builds it, this file only inserts it). It runs
// after the plans and the base accounts, which the file name keeps in order. Like them it refuses a
// remote database (seed guard), because the accounts it logs in with have a public password.
const ORGANIZATION_SLUG = "tokomaju";
const DEMO_PLAN = "Business"; // Starter allows 2 warehouses; the demo has 3.

const one = async (queryInterface, sql, replacements, transaction) => {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements, transaction });
  return rows[0];
};

async function loadOrganization(queryInterface) {
  const organization = await one(queryInterface, `SELECT "id" FROM "Organizations" WHERE "slug" = :slug`, { slug: ORGANIZATION_SLUG });
  if (!organization) throw new Error("Organization not found: run the base accounts seeder first.");
  return organization.id;
}

// The three logins of the base seed, by role.
async function loadUsers(queryInterface, organizationId) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT "id", "role" FROM "Users" WHERE "organizationId" = :organizationId AND "role" IN ('OWNER', 'WAREHOUSE_ADMIN', 'VIEWER')`,
    { replacements: { organizationId } },
  );
  const byRole = Object.fromEntries(rows.map((row) => [row.role, row.id]));
  for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]) {
    if (!byRole[role]) throw new Error(`User with role ${role} not found: run the base accounts seeder first.`);
  }
  return byRole;
}

// One run fills an empty organization; a second run finds a warehouse and does nothing, so history
// is never doubled (a movement cannot be deleted, rule 10). Use the reset script to start over.
const alreadySeeded = async (queryInterface, organizationId) =>
  Boolean(await one(queryInterface, `SELECT 1 AS found FROM "Warehouses" WHERE "organizationId" = :organizationId LIMIT 1`, { organizationId }));

const ids = (rows) => new Map(rows.map((row) => [row.key, crypto.randomUUID()]));

async function insertAll(queryInterface, organizationId, users, data, transaction) {
  const warehouseId = ids(data.warehouses.map((w) => ({ key: w.code })));
  const productId = ids(data.products.map((p) => ({ key: p.sku })));
  const transferId = ids(data.transfers.map((t) => ({ key: t.code })));
  const insert = (table, rows) => (rows.length ? queryInterface.bulkInsert(table, rows, { transaction }) : null);

  await insert("Warehouses", data.warehouses.map((w) => ({ id: warehouseId.get(w.code), organizationId, code: w.code, name: w.name, address: w.address })));
  await insert("Products", data.products.map((p) => ({ id: productId.get(p.sku), organizationId, sku: p.sku, name: p.name, unit: p.unit, minStock: p.minStock })));

  const assign = (userId, codes) => codes.map((code) => ({ organizationId, userId, warehouseId: warehouseId.get(code) }));
  await insert("UserWarehouses", [...assign(users.WAREHOUSE_ADMIN, data.adminWarehouseCodes), ...assign(users.VIEWER, data.viewerWarehouseCodes)]);

  await insert(
    "StockTransfers",
    data.transfers.map((t) => ({
      id: transferId.get(t.code),
      organizationId,
      code: t.code,
      fromWarehouseId: warehouseId.get(t.fromWarehouseCode),
      toWarehouseId: warehouseId.get(t.toWarehouseCode),
      note: t.note,
      createdById: users[t.by],
      createdAt: t.createdAt,
      updatedAt: t.createdAt,
    })),
  );

  await insert("StockLevels", data.levels.map((l) => ({ organizationId, warehouseId: warehouseId.get(l.warehouseCode), productId: productId.get(l.sku), quantity: l.quantity })));

  await insert(
    "StockMovements",
    data.movements.map((m) => ({
      organizationId,
      warehouseId: warehouseId.get(m.warehouseCode),
      productId: productId.get(m.sku),
      quantityDelta: m.quantityDelta,
      type: m.type,
      reason: m.reason,
      note: m.note,
      transferId: m.transferCode ? transferId.get(m.transferCode) : null,
      createdById: users[m.by],
      createdAt: m.createdAt,
    })),
  );
}

// 3 warehouses on a Starter plan would break its own limit, so the demo organization moves to Business.
async function moveToDemoPlan(queryInterface, organizationId, transaction) {
  await queryInterface.sequelize.query(
    `UPDATE "Subscriptions" SET "planId" = (SELECT "id" FROM "Plans" WHERE "name" = :plan) WHERE "organizationId" = :organizationId`,
    { replacements: { plan: DEMO_PLAN, organizationId }, transaction },
  );
}

// `now` is the end of the history; the CLI passes the current time, a test passes a fixed instant.
// Returns true when it seeded, false when the organization already had warehouses.
async function seedDemo(queryInterface, now = new Date()) {
  const organizationId = await loadOrganization(queryInterface);
  if (await alreadySeeded(queryInterface, organizationId)) return false;
  const users = await loadUsers(queryInterface, organizationId);
  const data = buildDemoData(now);

  // One transaction: a failure in the middle leaves nothing half-seeded (the next run would skip it).
  await queryInterface.sequelize.transaction(async (transaction) => {
    await moveToDemoPlan(queryInterface, organizationId, transaction);
    await insertAll(queryInterface, organizationId, users, data, transaction);
  });
  return true;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  seedDemo,

  async up(queryInterface) {
    assertSeedAllowed(queryInterface.sequelize);
    const seeded = await seedDemo(queryInterface);
    // eslint-disable-next-line no-console
    console.log(seeded ? "Demo stock seeded." : "Demo stock already present: nothing to do (use the reset script to start over).");
  },

  // A stock movement cannot be deleted (append-only trigger, ADR 0005), so a seed cannot undo it
  // row by row. Starting over is the reset script's job; undoing is deliberately a no-op.
  async down(queryInterface) {
    assertSeedAllowed(queryInterface.sequelize);
  },
};
