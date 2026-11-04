"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Plans", {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        // Created by the database, so a seed or a manual INSERT gets an ID too.
        defaultValue: Sequelize.literal("gen_random_uuid()"),
      },
      name: { type: Sequelize.STRING(50), allowNull: false },
      priceIdr: { type: Sequelize.INTEGER, allowNull: false },
      maxWarehouses: { type: Sequelize.INTEGER, allowNull: false },
      maxProducts: { type: Sequelize.INTEGER, allowNull: false },
      maxMembers: { type: Sequelize.INTEGER, allowNull: false },
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

    // Named constraints: the tests and the API error mapping refer to these names.
    await queryInterface.sequelize.query(`
      ALTER TABLE "Plans"
        ADD CONSTRAINT "Plans_name_key" UNIQUE ("name"),
        ADD CONSTRAINT "Plans_priceIdr_check" CHECK ("priceIdr" >= 0),
        ADD CONSTRAINT "Plans_maxWarehouses_check" CHECK ("maxWarehouses" >= 1),
        ADD CONSTRAINT "Plans_maxProducts_check" CHECK ("maxProducts" >= 1),
        ADD CONSTRAINT "Plans_maxMembers_check" CHECK ("maxMembers" >= 1)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Plans");
  },
};
