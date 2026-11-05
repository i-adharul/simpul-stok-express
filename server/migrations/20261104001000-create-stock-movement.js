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
    await queryInterface.createTable("StockMovements", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      organizationId: uuidFk(Sequelize, "Organizations"),
      warehouseId: uuidFk(Sequelize, "Warehouses"),
      productId: uuidFk(Sequelize, "Products"),
      // Signed change: positive adds stock, negative removes it.
      quantityDelta: { type: Sequelize.INTEGER, allowNull: false },
      type: {
        type: Sequelize.ENUM(
          "RECEIVE",
          "ADJUST",
          "TRANSFER_OUT",
          "TRANSFER_IN",
          "IMPORT",
        ),
        allowNull: false,
      },
      // Only for ADJUST (docs/03 E09).
      reason: {
        type: Sequelize.ENUM("STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"),
        allowNull: true,
      },
      note: { type: Sequelize.STRING(255), allowNull: true },
      transferId: uuidFk(Sequelize, "StockTransfers", true),
      // The foreign key to ImportJobs is added by the migration that creates that table (E0-06).
      importJobId: { type: Sequelize.UUID, allowNull: true },
      createdById: uuidFk(Sequelize, "Users", true),
      // Append-only: no updatedAt (ADR 0005).
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("now()"),
      },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE "StockMovements"
        ADD CONSTRAINT "StockMovements_quantityDelta_check" CHECK (
          CASE "type"
            WHEN 'TRANSFER_OUT' THEN "quantityDelta" < 0
            WHEN 'ADJUST' THEN "quantityDelta" <> 0
            ELSE "quantityDelta" > 0
          END),
        ADD CONSTRAINT "StockMovements_reason_check" CHECK (("type" = 'ADJUST') = ("reason" IS NOT NULL)),
        ADD CONSTRAINT "StockMovements_transferId_check"
          CHECK (("type" IN ('TRANSFER_OUT', 'TRANSFER_IN')) = ("transferId" IS NOT NULL)),
        ADD CONSTRAINT "StockMovements_importJobId_check" CHECK (("type" = 'IMPORT') = ("importJobId" IS NOT NULL))
    `);
    // Tenant rule 4 (docs/03): composite indexes on large tables start with organizationId.
    await queryInterface.addIndex(
      "StockMovements",
      ["organizationId", "createdAt", "id"],
      {
        name: "StockMovements_organizationId_createdAt_id_idx",
      },
    );
    await queryInterface.addIndex(
      "StockMovements",
      ["organizationId", "warehouseId", "createdAt"],
      { name: "StockMovements_organizationId_warehouseId_createdAt_idx" },
    );
    await queryInterface.addIndex(
      "StockMovements",
      ["organizationId", "productId", "createdAt"],
      { name: "StockMovements_organizationId_productId_createdAt_idx" },
    );
    // PostgreSQL does not index the referencing column of a foreign key by itself.
    await queryInterface.addIndex("StockMovements", ["transferId"], {
      name: "StockMovements_transferId_idx",
    });
    await queryInterface.addIndex("StockMovements", ["importJobId"], {
      name: "StockMovements_importJobId_idx",
    });
    await queryInterface.addIndex("StockMovements", ["createdById"], {
      name: "StockMovements_createdById_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("StockMovements");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_StockMovements_type"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_StockMovements_reason"',
    );
  },
};
