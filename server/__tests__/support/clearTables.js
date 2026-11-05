// Child tables first, so no delete hits a foreign key. Every schema test file calls this in
// beforeEach and afterAll: the files share one database, and a leftover row would break the
// delete in another file. Add a table here when its migration is added.
const TABLES_CHILD_FIRST = [
  "StockLevels",
  "UserWarehouses",
  "Warehouses",
  "Products",
];
const EARLIER_TABLES = ["Subscriptions", "Users", "Organizations", "Plans"];

async function clearTables(sequelize) {
  for (const table of [...TABLES_CHILD_FIRST, ...EARLIER_TABLES]) {
    await sequelize.query(`DELETE FROM "${table}"`);
  }
}

module.exports = { clearTables };
