const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StockTransfer extends Model {
    static associate(models) {
      StockTransfer.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      StockTransfer.belongsTo(models.Warehouse, {
        foreignKey: "fromWarehouseId",
        as: "fromWarehouse",
      });
      StockTransfer.belongsTo(models.Warehouse, {
        foreignKey: "toWarehouseId",
        as: "toWarehouse",
      });
      StockTransfer.belongsTo(models.User, {
        foreignKey: "createdById",
        as: "createdBy",
      });
      StockTransfer.hasMany(models.StockMovement, { foreignKey: "transferId" });
    }
  }

  StockTransfer.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      code: { type: DataTypes.STRING(20), allowNull: false },
      fromWarehouseId: { type: DataTypes.UUID, allowNull: false },
      toWarehouseId: { type: DataTypes.UUID, allowNull: false },
      note: { type: DataTypes.STRING(255), allowNull: true },
      createdById: { type: DataTypes.UUID, allowNull: true },
    },
    { sequelize, modelName: "StockTransfer", tableName: "StockTransfers" },
  );

  return StockTransfer;
};
