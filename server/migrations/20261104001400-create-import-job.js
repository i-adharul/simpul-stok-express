"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ImportJobs", {
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
      fileName: { type: Sequelize.STRING(255), allowNull: false },
      status: {
        type: Sequelize.ENUM("PREVIEW", "COMMITTED", "FAILED"),
        allowNull: false,
        defaultValue: "PREVIEW",
      },
      totalRows: { type: Sequelize.INTEGER, allowNull: false },
      errorRows: { type: Sequelize.INTEGER, allowNull: false },
      // The validation result shown to the user: one entry per bad row.
      errorReport: { type: Sequelize.JSONB, allowNull: true },
      // The valid rows, kept for the commit step (BL18).
      rows: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal("'[]'::jsonb"),
      },
      createdById: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
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

    // BL18: at most 5,000 rows; a commit only happens when errorRows = 0.
    await queryInterface.sequelize.query(`
      ALTER TABLE "ImportJobs"
        ADD CONSTRAINT "ImportJobs_totalRows_check" CHECK ("totalRows" BETWEEN 0 AND 5000),
        ADD CONSTRAINT "ImportJobs_errorRows_check" CHECK ("errorRows" BETWEEN 0 AND "totalRows"),
        ADD CONSTRAINT "ImportJobs_committed_check" CHECK ("status" <> 'COMMITTED' OR "errorRows" = 0)
    `);
    await queryInterface.addIndex(
      "ImportJobs",
      ["organizationId", "createdAt"],
      {
        name: "ImportJobs_organizationId_createdAt_idx",
      },
    );
    await queryInterface.addIndex("ImportJobs", ["createdById"], {
      name: "ImportJobs_createdById_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ImportJobs");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_ImportJobs_status"',
    );
  },
};
