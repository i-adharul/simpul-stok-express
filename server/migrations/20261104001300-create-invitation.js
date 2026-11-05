"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Invitations", {
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
      email: { type: Sequelize.STRING(255), allowNull: false },
      // The Owner role cannot be granted: every organization has exactly one Owner (BL07).
      role: {
        type: Sequelize.ENUM("WAREHOUSE_ADMIN", "VIEWER"),
        allowNull: false,
      },
      // A list of IDs, not a foreign key (docs/ERD_Relations.md); checked when the invitation is accepted.
      warehouseIds: {
        type: Sequelize.ARRAY(Sequelize.UUID),
        allowNull: false,
        defaultValue: Sequelize.literal("'{}'::uuid[]"),
      },
      // Only the hash of the random token is stored; the link is shown once (BL05).
      tokenHash: { type: Sequelize.STRING(100), allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      // Pending, Expired and Accepted are derived from expiresAt and acceptedAt.
      acceptedAt: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.sequelize.query(`
      ALTER TABLE "Invitations"
        ADD CONSTRAINT "Invitations_tokenHash_key" UNIQUE ("tokenHash"),
        ADD CONSTRAINT "Invitations_email_lowercase_check" CHECK ("email" = lower("email")),
        ADD CONSTRAINT "Invitations_expiresAt_check" CHECK ("expiresAt" > "createdAt")
    `);
    // Serves the "pending invitation for this email" check (BL05) and the member list (S14).
    await queryInterface.addIndex("Invitations", ["organizationId", "email"], {
      name: "Invitations_organizationId_email_idx",
    });
    await queryInterface.addIndex("Invitations", ["createdById"], {
      name: "Invitations_createdById_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Invitations");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Invitations_role"',
    );
  },
};
