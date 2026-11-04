"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Subscriptions", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Organizations", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      planId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Plans", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      // Empty during the trial; filled on the first payment (BL21, BL22).
      billingDay: { type: Sequelize.INTEGER, allowNull: true },
      currentPeriodStart: { type: Sequelize.DATE, allowNull: false },
      currentPeriodEnd: { type: Sequelize.DATE, allowNull: false },
      graceUntil: { type: Sequelize.DATE, allowNull: false },
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

    // The status is not stored here: it lives in Organization.status (BL23).
    await queryInterface.sequelize.query(`
      ALTER TABLE "Subscriptions"
        ADD CONSTRAINT "Subscriptions_organizationId_key" UNIQUE ("organizationId"),
        ADD CONSTRAINT "Subscriptions_billingDay_check" CHECK ("billingDay" BETWEEN 1 AND 31),
        ADD CONSTRAINT "Subscriptions_period_check" CHECK ("currentPeriodEnd" > "currentPeriodStart"),
        ADD CONSTRAINT "Subscriptions_grace_check" CHECK ("graceUntil" >= "currentPeriodEnd")
    `);
    await queryInterface.addIndex("Subscriptions", ["planId"], {
      name: "Subscriptions_planId_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Subscriptions");
  },
};
