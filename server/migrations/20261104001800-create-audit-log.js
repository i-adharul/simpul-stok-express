"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("AuditLogs", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      // A platform admin's action on an organization uses that organization's ID (BL25).
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Organizations", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      // Empty for an action done by the system (for example the daily cron).
      actorId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      // Format entity.action, for example stock.transfer.create (BL26).
      action: { type: Sequelize.STRING(100), allowNull: false },
      entityType: { type: Sequelize.STRING(50), allowNull: false },
      // A loose reference, not a foreign key (ERD no. 37): the target can be any table.
      entityId: { type: Sequelize.UUID, allowNull: true },
      // Simple details shown on S18; never secrets or request bodies.
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal("'{}'::jsonb"),
      },
      // Append-only: no updatedAt.
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE "AuditLogs"
        ADD CONSTRAINT "AuditLogs_action_check" CHECK ("action" ~ '^[a-z]+(\\.[a-z]+)+$')
    `);
    // The same function as StockMovements (ADR 0005): the log cannot be edited or erased.
    await queryInterface.sequelize.query(`
      CREATE TRIGGER "AuditLogs_append_only_trg"
        BEFORE UPDATE OR DELETE ON "AuditLogs"
        FOR EACH ROW EXECUTE FUNCTION prevent_row_change()
    `);
    await queryInterface.addIndex(
      "AuditLogs",
      ["organizationId", "createdAt", "id"],
      {
        name: "AuditLogs_organizationId_createdAt_id_idx",
      },
    );
    await queryInterface.addIndex("AuditLogs", ["actorId"], {
      name: "AuditLogs_actorId_idx",
    });
  },

  async down(queryInterface) {
    // Dropping the table also drops its trigger; the shared function stays for StockMovements.
    await queryInterface.dropTable("AuditLogs");
  },
};
