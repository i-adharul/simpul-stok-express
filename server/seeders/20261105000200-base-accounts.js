"use strict";

const {
  assertSeedAllowed,
  resolveSeedPassword,
} = require("../helpers/seedGuard");

const bcrypt = require("bcryptjs");
const { PROFILES } = require("../helpers/demoProfiles");

// The local demo password, shared by every seeded account. It is public on purpose: on a remote
// database the seeder needs SEED_PASSWORD instead and refuses this value (helpers/seedGuard.js).
const DEMO_PASSWORD = "Simpul-Demo-2026";
const BCRYPT_COST = 12; // CLAUDE.md / docs/05: bcryptjs, cost 12.

// The demo organizations come from helpers/demoProfiles.js (slug and name). Each has one Owner, one
// Warehouse Admin and one Viewer. Emails are unique across the whole table, so the second
// organization uses its own domain part. The Platform admin belongs to no organization.
const TENANT_ACCOUNTS = {
  tokomaju: [
    { email: "owner@example.com", name: "Budi Owner", role: "OWNER" },
    { email: "admin@example.com", name: "Sari Admin Gudang", role: "WAREHOUSE_ADMIN" },
    { email: "viewer@example.com", name: "Dewi Viewer", role: "VIEWER" },
  ],
  kopisenja: [
    { email: "owner@kopisenja.example.com", name: "Rina Owner", role: "OWNER" },
    { email: "admin@kopisenja.example.com", name: "Agus Admin Gudang", role: "WAREHOUSE_ADMIN" },
    { email: "viewer@kopisenja.example.com", name: "Tika Viewer", role: "VIEWER" },
  ],
};
const PLATFORM_ACCOUNT = { email: "platform@example.com", name: "Platform Admin", role: "PLATFORM_ADMIN" };

const ORGANIZATIONS = PROFILES.map((profile) => ({
  name: profile.name,
  slug: profile.slug,
  accounts: TENANT_ACCOUNTS[profile.slug],
}));

const DAY_MS = 24 * 60 * 60 * 1000;

async function findId(queryInterface, table, column, value) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT "id" FROM "${table}" WHERE "${column}" = :value`,
    { replacements: { value } },
  );
  return rows[0]?.id;
}

async function insertOrganization(queryInterface, organization) {
  await queryInterface.sequelize.query(
    `INSERT INTO "Organizations" ("name", "slug") VALUES (:name, :slug) ON CONFLICT ("slug") DO NOTHING`,
    { replacements: { name: organization.name, slug: organization.slug } },
  );
  return findId(queryInterface, "Organizations", "slug", organization.slug);
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
        organizationId,
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash,
      },
    },
  );
}

// One organization: the row, its trial subscription and its three accounts.
async function seedOrganization(queryInterface, organization, passwordHash) {
  const organizationId = await insertOrganization(queryInterface, organization);
  await insertTrialSubscription(queryInterface, organizationId);
  for (const account of organization.accounts) {
    await insertAccount(queryInterface, account, organizationId, passwordHash);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  ORGANIZATIONS,

  async up(queryInterface) {
    assertSeedAllowed(queryInterface.sequelize);
    const password = resolveSeedPassword(queryInterface.sequelize, {
      demoPassword: DEMO_PASSWORD,
    });
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    for (const organization of ORGANIZATIONS) {
      await seedOrganization(queryInterface, organization, passwordHash);
    }
    await insertAccount(queryInterface, PLATFORM_ACCOUNT, null, passwordHash);
  },

  async down(queryInterface) {
    assertSeedAllowed(queryInterface.sequelize);
    const emails = [PLATFORM_ACCOUNT, ...ORGANIZATIONS.flatMap((organization) => organization.accounts)].map((account) => account.email);
    await queryInterface.sequelize.query('DELETE FROM "Users" WHERE "email" IN (:emails)', { replacements: { emails } });
    for (const { slug } of ORGANIZATIONS) {
      const organizationId = await findId(queryInterface, "Organizations", "slug", slug);
      if (!organizationId) continue;
      await queryInterface.sequelize.query('DELETE FROM "Subscriptions" WHERE "organizationId" = :organizationId', { replacements: { organizationId } });
      await queryInterface.sequelize.query('DELETE FROM "Organizations" WHERE "id" = :organizationId', { replacements: { organizationId } });
    }
  },
};
