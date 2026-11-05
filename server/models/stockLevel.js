const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StockLevel extends Model {
    static associate(models) {
      StockLevel.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      StockLevel.belongsTo(models.Warehouse, { foreignKey: "warehouseId" });
      StockLevel.belongsTo(models.Product, { foreignKey: "productId" });
    }
  }

  StockLevel.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      warehouseId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    { sequelize, modelName: "StockLevel", tableName: "StockLevels" },
  );

  return StockLevel;
};
