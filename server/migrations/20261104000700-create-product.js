"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Products", {
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
      sku: { type: Sequelize.STRING(50), allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      // Fixed list (docs/02, BL09): bungkus, kotak, pieces, botol, jerigen, pak.
      unit: {
        type: Sequelize.ENUM("bks", "ktk", "pcs", "btl", "jrg", "pak"),
        allowNull: false,
      },
      minStock: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // A product is archived, never deleted: its movements stay readable (BL09).
      archivedAt: { type: Sequelize.DATE, allowNull: true },
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

    // The unique key starts with organizationId, so it also serves "products of this organization".
    await queryInterface.sequelize.query(`
      ALTER TABLE "Products"
        ADD CONSTRAINT "Products_organizationId_sku_key" UNIQUE ("organizationId", "sku"),
        ADD CONSTRAINT "Products_sku_check" CHECK ("sku" = upper("sku") AND "sku" ~ '^[^[:space:]]+$'),
        ADD CONSTRAINT "Products_name_check" CHECK (btrim("name") <> ''),
        ADD CONSTRAINT "Products_minStock_check" CHECK ("minStock" BETWEEN 0 AND 1000000000)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Products");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Products_unit"',
    );
  },
};
