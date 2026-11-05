const fs = require("fs");
const path = require("path");
const Sequelize = require("sequelize");
const env = require("../config/env");
const config = require("../config/config");

// NODE_ENV picks the connection: tests get TEST_DATABASE_URL, never DATABASE_URL,
// so a test run cannot reach the development data (it empties its tables).
const { url, ...options } = config[env.NODE_ENV];
const sequelize = new Sequelize(url, options);

const db = {};

// Every other .js file in this folder defines one model.
fs.readdirSync(__dirname)
  .filter((file) => file !== path.basename(__filename) && file.endsWith(".js"))
  .forEach((file) => {
    const model = require(path.join(__dirname, file))(
      sequelize,
      Sequelize.DataTypes,
    );
    db[model.name] = model;
  });

// Associations need every model to exist first, so they run in a second pass.
Object.values(db).forEach((model) => {
  if (model.associate) model.associate(db);
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
