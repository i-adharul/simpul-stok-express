"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Organizations", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      name: { type: Sequelize.STRING(100), allowNull: false },
      slug: { type: Sequelize.STRING(30), allowNull: false },
      address: { type: Sequelize.TEXT, allowNull: true },
      // The only stored subscription status (BL23); a new organization starts in its trial.
      status: {
        type: Sequelize.ENUM("TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED"),
        allowNull: false,
        defaultValue: "TRIAL",
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
      ALTER TABLE "Organizations"
        ADD CONSTRAINT "Organizations_slug_key" UNIQUE ("slug"),
        ADD CONSTRAINT "Organizations_slug_check" CHECK ("slug" ~ '^[a-z0-9]{3,30}$')
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Organizations");
    // dropTable leaves the enum type behind, and a second db:migrate would fail on it.
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_Organizations_status"',
    );
  },
};
