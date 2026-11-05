"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("StockLevels", {
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
      warehouseId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Warehouses", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      productId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Products", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.sequelize.query(`
      ALTER TABLE "StockLevels"
        ADD CONSTRAINT "StockLevels_warehouseId_productId_key" UNIQUE ("warehouseId", "productId"),
        ADD CONSTRAINT "StockLevels_quantity_check" CHECK ("quantity" >= 0)
    `);
    // Tenant rule 4 (docs/03): composite indexes on large tables start with organizationId.
    // The unique key above already serves lookups by warehouse.
    await queryInterface.addIndex(
      "StockLevels",
      ["organizationId", "warehouseId"],
      {
        name: "StockLevels_organizationId_warehouseId_idx",
      },
    );
    await queryInterface.addIndex(
      "StockLevels",
      ["organizationId", "productId"],
      {
        name: "StockLevels_organizationId_productId_idx",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("StockLevels");
  },
};
