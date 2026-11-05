"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // One function for every append-only table (AuditLog reuses it in E0-06).
    // TG_TABLE_NAME keeps the message accurate for each table.
    await queryInterface.sequelize.query(`
      CREATE FUNCTION prevent_row_change() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% rows are append-only: % is not allowed', TG_TABLE_NAME, TG_OP
          USING ERRCODE = 'restrict_violation';
      END;
      $$ LANGUAGE plpgsql
    `);
    // BEFORE ... FOR EACH ROW: the change is refused before it touches the row.
    // TRUNCATE is a separate statement-level event and is not blocked (ADR 0005).
    await queryInterface.sequelize.query(`
      CREATE TRIGGER "StockMovements_append_only_trg"
        BEFORE UPDATE OR DELETE ON "StockMovements"
        FOR EACH ROW EXECUTE FUNCTION prevent_row_change()
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP TRIGGER IF EXISTS "StockMovements_append_only_trg" ON "StockMovements"',
    );
    await queryInterface.sequelize.query(
      "DROP FUNCTION IF EXISTS prevent_row_change()",
    );
  },
};
