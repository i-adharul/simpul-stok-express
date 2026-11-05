"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Warehouses", {
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
      code: { type: Sequelize.STRING(20), allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      address: { type: Sequelize.STRING(255), allowNull: true },
      // A warehouse is archived, never deleted (BL08).
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

    // The unique key starts with organizationId, so it also serves every "warehouses of this
    // organization" query; no separate index on organizationId is needed.
    await queryInterface.sequelize.query(`
      ALTER TABLE "Warehouses"
        ADD CONSTRAINT "Warehouses_organizationId_code_key" UNIQUE ("organizationId", "code"),
        ADD CONSTRAINT "Warehouses_code_check" CHECK ("code" = upper(btrim("code")) AND "code" <> ''),
        ADD CONSTRAINT "Warehouses_name_check" CHECK (btrim("name") <> '')
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Warehouses");
  },
};
