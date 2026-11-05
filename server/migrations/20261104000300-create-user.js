"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Users", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      // Empty only for a platform admin (docs/03_Data_Model.md).
      // RESTRICT: business data is archived, so deleting an organization must fail, not cascade.
      organizationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "Organizations", key: "id" },
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
      },
      email: { type: Sequelize.STRING(255), allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      passwordHash: { type: Sequelize.STRING(100), allowNull: false },
      role: {
        type: Sequelize.ENUM(
          "PLATFORM_ADMIN",
          "OWNER",
          "WAREHOUSE_ADMIN",
          "VIEWER",
        ),
        allowNull: false,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastLoginAt: { type: Sequelize.DATE, allowNull: true },
      // A session created before this moment is rejected (BL01).
      passwordChangedAt: { type: Sequelize.DATE, allowNull: true },
      // Only filled while an Owner has generated a reset link (BL07); the token itself is never stored.
      resetTokenHash: { type: Sequelize.STRING(100), allowNull: true },
      resetExpiresAt: { type: Sequelize.DATE, allowNull: true },
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
      ALTER TABLE "Users"
        ADD CONSTRAINT "Users_email_key" UNIQUE ("email"),
        ADD CONSTRAINT "Users_email_lowercase_check" CHECK ("email" = lower("email")),
        ADD CONSTRAINT "Users_role_organization_check"
          CHECK (("role" = 'PLATFORM_ADMIN') = ("organizationId" IS NULL)),
        ADD CONSTRAINT "Users_reset_pair_check"
          CHECK (("resetTokenHash" IS NULL) = ("resetExpiresAt" IS NULL))
    `);
    // PostgreSQL does not index the referencing column of a foreign key by itself.
    await queryInterface.addIndex("Users", ["organizationId"], {
      name: "Users_organizationId_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Users");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Users_role"',
    );
  },
};
