"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("UserWarehouses", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      // Copied from the warehouse so tenant queries can filter this table directly.
      // The application keeps it equal to the organization of both parents (ADR 0006).
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Organizations", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "Users", key: "id" },
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
      ALTER TABLE "UserWarehouses"
        ADD CONSTRAINT "UserWarehouses_userId_warehouseId_key" UNIQUE ("userId", "warehouseId")
    `);
    // The unique key serves lookups by userId; these two serve the other foreign keys.
    await queryInterface.addIndex("UserWarehouses", ["warehouseId"], {
      name: "UserWarehouses_warehouseId_idx",
    });
    await queryInterface.addIndex("UserWarehouses", ["organizationId"], {
      name: "UserWarehouses_organizationId_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("UserWarehouses");
  },
};
