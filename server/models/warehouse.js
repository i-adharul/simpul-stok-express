const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Warehouse extends Model {
    static associate(models) {
      Warehouse.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      Warehouse.hasMany(models.UserWarehouse, { foreignKey: "warehouseId" });
    }
  }

  Warehouse.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      code: { type: DataTypes.STRING(20), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      address: { type: DataTypes.STRING(255), allowNull: true },
      archivedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "Warehouse", tableName: "Warehouses" },
  );

  return Warehouse;
};
