const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StockMovement extends Model {
    static associate(models) {
      StockMovement.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      StockMovement.belongsTo(models.Warehouse, { foreignKey: "warehouseId" });
      StockMovement.belongsTo(models.Product, { foreignKey: "productId" });
      StockMovement.belongsTo(models.StockTransfer, {
        foreignKey: "transferId",
      });
      StockMovement.belongsTo(models.ImportJob, { foreignKey: "importJobId" });
      StockMovement.belongsTo(models.User, {
        foreignKey: "createdById",
        as: "createdBy",
      });
    }
  }

  // Rows are never updated (database trigger, ADR 0005), so there is no updatedAt.
  StockMovement.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      warehouseId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      quantityDelta: { type: DataTypes.INTEGER, allowNull: false },
      type: {
        type: DataTypes.ENUM(
          "RECEIVE",
          "ADJUST",
          "TRANSFER_OUT",
          "TRANSFER_IN",
          "IMPORT",
        ),
        allowNull: false,
      },
      reason: {
        type: DataTypes.ENUM("STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"),
        allowNull: true,
      },
      note: { type: DataTypes.STRING(255), allowNull: true },
      transferId: { type: DataTypes.UUID, allowNull: true },
      importJobId: { type: DataTypes.UUID, allowNull: true },
      createdById: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: "StockMovement",
      tableName: "StockMovements",
      updatedAt: false,
    },
  );

  return StockMovement;
};
