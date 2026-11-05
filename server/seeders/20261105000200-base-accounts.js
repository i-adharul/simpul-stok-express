"use strict";

const bcrypt = require("bcryptjs");

// A local demo password, shared by every seeded account. It is public on purpose, which is why
// the seed refuses to run against a remote database (see the guard added in the next step).
const DEMO_PASSWORD = "Simpul-Demo-2026";
const BCRYPT_COST = 12; // CLAUDE.md / docs/05: bcryptjs, cost 12.

const ORGANIZATION = { name: "Toko Maju", slug: "tokomaju" };
const ACCOUNTS = [
  {
    email: "owner@example.com",
    name: "Budi Owner",
    role: "OWNER",
    inOrganization: true,
  },
  {
    email: "admin@example.com",
    name: "Sari Admin Gudang",
    role: "WAREHOUSE_ADMIN",
    inOrganization: true,
  },
  {
    email: "viewer@example.com",
    name: "Dewi Viewer",
    role: "VIEWER",
    inOrganization: true,
  },
  {
    email: "platform@example.com",
    name: "Platform Admin",
    role: "PLATFORM_ADMIN",
    inOrganization: false,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

async function findId(queryInterface, table, column, value) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT "id" FROM "${table}" WHERE "${column}" = :value`,
    { replacements: { value } },
  );
  return rows[0]?.id;
}

async function insertOrganization(queryInterface) {
  await queryInterface.sequelize.query(
    `INSERT INTO "Organizations" ("name", "slug") VALUES (:name, :slug) ON CONFLICT ("slug") DO NOTHING`,
    { replacements: ORGANIZATION },
  );
  return findId(queryInterface, "Organizations", "slug", ORGANIZATION.slug);
}

// A new organization starts a 30-day trial on Starter (BL04): grace ends 3 days after the period.
async function insertTrialSubscription(queryInterface, organizationId) {
  const planId = await findId(queryInterface, "Plans", "name", "Starter");
  if (!planId)
    throw new Error("Starter plan not found: run the plans seeder first.");
  const start = new Date();
  const end = new Date(start.getTime() + 30 * DAY_MS);
  const graceUntil = new Date(end.getTime() + 3 * DAY_MS);
  await queryInterface.sequelize.query(
    `INSERT INTO "Subscriptions" ("organizationId", "planId", "currentPeriodStart", "currentPeriodEnd", "graceUntil")
     VALUES (:organizationId, :planId, :start, :end, :graceUntil)
     ON CONFLICT ("organizationId") DO NOTHING`,
    { replacements: { organizationId, planId, start, end, graceUntil } },
  );
}

async function insertAccount(
  queryInterface,
  account,
  organizationId,
  passwordHash,
) {
  await queryInterface.sequelize.query(
    `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role")
     VALUES (:organizationId, :email, :name, :passwordHash, CAST(:role AS "enum_Users_role"))
     ON CONFLICT ("email") DO NOTHING`,
    {
      replacements: {
        organizationId: account.inOrganization ? organizationId : null,
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash,
      },
    },
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const organizationId = await insertOrganization(queryInterface);
    await insertTrialSubscription(queryInterface, organizationId);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
    for (const account of ACCOUNTS) {
      await insertAccount(
        queryInterface,
        account,
        organizationId,
        passwordHash,
      );
    }
  },

  async down(queryInterface) {
    const organizationId = await findId(
      queryInterface,
      "Organizations",
      "slug",
      ORGANIZATION.slug,
    );
    await queryInterface.sequelize.query(
      'DELETE FROM "Users" WHERE "email" IN (:emails)',
      {
        replacements: { emails: ACCOUNTS.map((account) => account.email) },
      },
    );
    if (organizationId) {
      await queryInterface.sequelize.query(
        'DELETE FROM "Subscriptions" WHERE "organizationId" = :organizationId',
        {
          replacements: { organizationId },
        },
      );
      await queryInterface.sequelize.query(
        'DELETE FROM "Organizations" WHERE "id" = :organizationId',
        {
          replacements: { organizationId },
        },
      );
    }
  },
};
