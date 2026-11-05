"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("IdempotencyKeys", {
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
      // The value of the Idempotency-Key header, a UUID (BL14).
      key: { type: Sequelize.UUID, allowNull: false },
      // Which operation the key was used for, for example "POST /api/stock/receive".
      endpoint: { type: Sequelize.STRING(100), allowNull: false },
      // The StockTransfer, StockMovement or ImportJob the first request created.
      // A loose reference (no foreign key): the target table depends on `endpoint` (ERD no. 36).
      resourceId: { type: Sequelize.UUID, allowNull: true },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
    });

    // The unique key is the single source of truth for "was this request already handled" (BL14).
    await queryInterface.sequelize.query(`
      ALTER TABLE "IdempotencyKeys"
        ADD CONSTRAINT "IdempotencyKeys_organizationId_key_endpoint_key"
          UNIQUE ("organizationId", "key", "endpoint")
    `);
    // Rows are deleted after 24 hours; the cleanup finds them by age.
    await queryInterface.addIndex("IdempotencyKeys", ["createdAt"], {
      name: "IdempotencyKeys_createdAt_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("IdempotencyKeys");
  },
};
