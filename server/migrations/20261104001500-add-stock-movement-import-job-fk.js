"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // The column was created with StockMovements; ImportJobs did not exist yet, so the
  // foreign key is added now. Applied migrations are not edited (ADR 0003).
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "StockMovements"
        ADD CONSTRAINT "StockMovements_importJobId_fkey"
          FOREIGN KEY ("importJobId") REFERENCES "ImportJobs" ("id")
          ON DELETE RESTRICT ON UPDATE RESTRICT
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE "StockMovements" DROP CONSTRAINT "StockMovements_importJobId_fkey"',
    );
  },
};
