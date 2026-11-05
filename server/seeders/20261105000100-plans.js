"use strict";

// Prices are examples (docs/02_Functional_Spec.md, design decision "Plans").
// A plan differs from another only in its limits, not in features.
const PLANS = [
  {
    name: "Starter",
    priceIdr: 300000,
    maxWarehouses: 2,
    maxProducts: 100,
    maxMembers: 3,
  },
  {
    name: "Business",
    priceIdr: 700000,
    maxWarehouses: 10,
    maxProducts: 500,
    maxMembers: 10,
  },
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const plan of PLANS) {
      // ON CONFLICT makes a second run harmless and never overwrites a price changed by hand.
      await queryInterface.sequelize.query(
        `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers")
         VALUES (:name, :priceIdr, :maxWarehouses, :maxProducts, :maxMembers)
         ON CONFLICT ("name") DO NOTHING`,
        { replacements: plan },
      );
    }
  },

  async down(queryInterface) {
    // Fails on purpose while a subscription still points to a plan (foreign key RESTRICT).
    await queryInterface.sequelize.query(
      'DELETE FROM "Plans" WHERE "name" IN (:names)',
      {
        replacements: { names: PLANS.map((plan) => plan.name) },
      },
    );
  },
};
