const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class UserWarehouse extends Model {
    static associate(models) {
      UserWarehouse.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      UserWarehouse.belongsTo(models.User, { foreignKey: "userId" });
      UserWarehouse.belongsTo(models.Warehouse, { foreignKey: "warehouseId" });
    }
  }

  UserWarehouse.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      warehouseId: { type: DataTypes.UUID, allowNull: false },
    },
    { sequelize, modelName: "UserWarehouse", tableName: "UserWarehouses" },
  );

  return UserWarehouse;
};
