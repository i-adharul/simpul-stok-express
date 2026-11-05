// Child tables first, so no delete hits a foreign key. Every schema test file calls this in
// beforeEach and afterAll: the files share one database, and a leftover row would break the
// delete in another file. Add a table here when its migration is added.
const TABLES_CHILD_FIRST = [
  "StockMovements",
  "StockTransfers",
  "StockLevels",
  "UserWarehouses",
  "Warehouses",
  "Products",
];
const EARLIER_TABLES = ["Subscriptions", "Users", "Organizations", "Plans"];

// A trigger refuses DELETE on these tables (ADR 0005), so they are emptied with TRUNCATE.
const APPEND_ONLY_TABLES = ["StockMovements"];

async function clearTables(sequelize) {
  for (const table of [...TABLES_CHILD_FIRST, ...EARLIER_TABLES]) {
    const statement = APPEND_ONLY_TABLES.includes(table)
      ? `TRUNCATE "${table}"`
      : `DELETE FROM "${table}"`;
    await sequelize.query(statement);
  }
}

module.exports = { clearTables };
