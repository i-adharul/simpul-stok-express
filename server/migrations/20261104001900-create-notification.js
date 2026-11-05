"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Notifications", {
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
      // The recipient: a notification is only visible to this user (BL30).
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      type: {
        type: Sequelize.ENUM(
          "LOW_STOCK",
          "INVOICE_DUE",
          "TRIAL_ENDING",
          "SUSPENDED",
        ),
        allowNull: false,
      },
      message: { type: Sequelize.STRING(255), allowNull: false },
      // Empty means unread.
      readAt: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.sequelize.query(`
      ALTER TABLE "Notifications"
        ADD CONSTRAINT "Notifications_message_check" CHECK (btrim("message") <> '')
    `);
    // The bell shows the 20 latest notifications of one user (docs/02, BL30).
    await queryInterface.addIndex(
      "Notifications",
      ["organizationId", "userId", "createdAt"],
      { name: "Notifications_organizationId_userId_createdAt_idx" },
    );
    await queryInterface.addIndex("Notifications", ["userId"], {
      name: "Notifications_userId_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Notifications");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Notifications_type"',
    );
  },
};
