"use strict";

const uuidFk = (Sequelize, table, allowNull = false) => ({
  type: Sequelize.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "RESTRICT",
});

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("StockTransfers", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      organizationId: uuidFk(Sequelize, "Organizations"),
      // Format MT-0001, sequential per organization (BL13); built by the application.
      code: { type: Sequelize.STRING(20), allowNull: false },
      fromWarehouseId: uuidFk(Sequelize, "Warehouses"),
      toWarehouseId: uuidFk(Sequelize, "Warehouses"),
      note: { type: Sequelize.STRING(255), allowNull: true },
      createdById: uuidFk(Sequelize, "Users", true),
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

    // A transfer is always completed and never edited: there is no status column.
    await queryInterface.sequelize.query(`
      ALTER TABLE "StockTransfers"
        ADD CONSTRAINT "StockTransfers_organizationId_code_key" UNIQUE ("organizationId", "code"),
        ADD CONSTRAINT "StockTransfers_warehouses_check" CHECK ("fromWarehouseId" <> "toWarehouseId")
    `);
    await queryInterface.addIndex(
      "StockTransfers",
      ["organizationId", "createdAt"],
      { name: "StockTransfers_organizationId_createdAt_idx" },
    );
    await queryInterface.addIndex("StockTransfers", ["fromWarehouseId"], {
      name: "StockTransfers_fromWarehouseId_idx",
    });
    await queryInterface.addIndex("StockTransfers", ["toWarehouseId"], {
      name: "StockTransfers_toWarehouseId_idx",
    });
    await queryInterface.addIndex("StockTransfers", ["createdById"], {
      name: "StockTransfers_createdById_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("StockTransfers");
  },
};
