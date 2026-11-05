"use strict";

const uuidFk = (Sequelize, table) => ({
  type: Sequelize.UUID,
  allowNull: false,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "RESTRICT",
});

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Invoices", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      organizationId: uuidFk(Sequelize, "Organizations"),
      subscriptionId: uuidFk(Sequelize, "Subscriptions"),
      // The plan in effect once the invoice is paid (BL21).
      planId: uuidFk(Sequelize, "Plans"),
      // Format INV-2026-0001, sequential per organization; built by the application.
      number: { type: Sequelize.STRING(30), allowNull: false },
      amountIdr: { type: Sequelize.INTEGER, allowNull: false },
      kind: {
        type: Sequelize.ENUM("INITIAL", "PLAN_CHANGE", "RENEWAL"),
        allowNull: false,
      },
      // Empty for an INITIAL invoice until it is paid: the period starts at payment (BL21, BL22).
      periodStart: { type: Sequelize.DATE, allowNull: true },
      periodEnd: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM("PENDING", "PAID", "EXPIRED", "FAILED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      // The Xendit invoice id and payment page; filled once Xendit has accepted the invoice.
      externalId: { type: Sequelize.STRING(100), allowNull: true },
      paymentUrl: { type: Sequelize.TEXT, allowNull: true },
      dueAt: { type: Sequelize.DATE, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
    });

    // UNIQUE ignores NULL, so several invoices without an externalId are allowed.
    await queryInterface.sequelize.query(`
      ALTER TABLE "Invoices"
        ADD CONSTRAINT "Invoices_organizationId_number_key" UNIQUE ("organizationId", "number"),
        ADD CONSTRAINT "Invoices_externalId_key" UNIQUE ("externalId"),
        ADD CONSTRAINT "Invoices_amountIdr_check" CHECK ("amountIdr" > 0),
        ADD CONSTRAINT "Invoices_period_check" CHECK (
          ("periodStart" IS NULL) = ("periodEnd" IS NULL)
          AND ("periodEnd" IS NULL OR "periodEnd" > "periodStart")),
        ADD CONSTRAINT "Invoices_expiresAt_check" CHECK ("expiresAt" >= "dueAt"),
        ADD CONSTRAINT "Invoices_paidAt_check" CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL))
    `);
    await queryInterface.addIndex("Invoices", ["organizationId", "createdAt"], {
      name: "Invoices_organizationId_createdAt_idx",
    });
    await queryInterface.addIndex("Invoices", ["organizationId", "status"], {
      name: "Invoices_organizationId_status_idx",
    });
    await queryInterface.addIndex("Invoices", ["subscriptionId"], {
      name: "Invoices_subscriptionId_idx",
    });
    await queryInterface.addIndex("Invoices", ["planId"], {
      name: "Invoices_planId_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Invoices");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Invoices_kind"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Invoices_status"',
    );
  },
};
