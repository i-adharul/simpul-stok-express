"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Global table: no organizationId. The link to an organization is Invoice.externalId (ERD no. 35).
    await queryInterface.createTable("WebhookEvents", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      provider: { type: Sequelize.STRING(30), allowNull: false },
      eventId: { type: Sequelize.STRING(255), allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false },
      receivedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
      // Empty while the event is not processed (or when it was for an unknown invoice).
      processedAt: { type: Sequelize.DATE, allowNull: true },
    });

    // The unique key decides "is this a duplicate event" (BL22).
    await queryInterface.sequelize.query(`
      ALTER TABLE "WebhookEvents"
        ADD CONSTRAINT "WebhookEvents_provider_eventId_key" UNIQUE ("provider", "eventId")
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("WebhookEvents");
  },
};
