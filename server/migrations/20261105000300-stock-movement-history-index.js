"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // The history (BL16) reads "newest first" within one organization, so the index runs the same
    // way: createdAt descending, id as the tie-breaker. It replaces the ascending index of the
    // same name (same columns, other direction), so the table does not carry two indexes for one job.
    await queryInterface.sequelize.query('DROP INDEX "StockMovements_organizationId_createdAt_id_idx"');
    await queryInterface.sequelize.query(`
      CREATE INDEX "StockMovements_organizationId_createdAt_id_idx"
        ON "StockMovements" ("organizationId", "createdAt" DESC, "id")
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX "StockMovements_organizationId_createdAt_id_idx"');
    await queryInterface.sequelize.query(`
      CREATE INDEX "StockMovements_organizationId_createdAt_id_idx"
        ON "StockMovements" ("organizationId", "createdAt", "id")
    `);
  },
};
