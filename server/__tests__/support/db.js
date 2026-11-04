const { Sequelize } = require("sequelize");
const env = require("../../config/env");

let sequelize;

// Created on first use, so test files that never touch the database
// (for example the config tests) do not open a connection.
function getSequelize() {
  if (!sequelize) {
    sequelize = new Sequelize(env.TEST_DATABASE_URL, {
      dialect: "postgres",
      logging: false,
    });
  }
  return sequelize;
}

// Jest waits for open handles otherwise; one close per test file keeps the run from hanging.
async function closeDatabase() {
  if (sequelize) {
    await sequelize.close();
    sequelize = undefined;
  }
}

module.exports = { getSequelize, closeDatabase };
