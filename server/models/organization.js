const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Organization extends Model {
    static associate(models) {
      Organization.hasMany(models.User, { foreignKey: "organizationId" });
      Organization.hasMany(models.Warehouse, { foreignKey: "organizationId" });
      Organization.hasMany(models.Product, { foreignKey: "organizationId" });
      Organization.hasOne(models.Subscription, {
        foreignKey: "organizationId",
      });
    }
  }

  Organization.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: { type: DataTypes.STRING(100), allowNull: false },
      slug: { type: DataTypes.STRING(30), allowNull: false, unique: true },
      address: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM("TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED"),
        allowNull: false,
        defaultValue: "TRIAL",
      },
    },
    { sequelize, modelName: "Organization", tableName: "Organizations" },
  );

  return Organization;
};
