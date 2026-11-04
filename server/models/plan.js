const { Model } = require("sequelize");

// Global table: the only tenant-less model besides WebhookEvent, so it has no organizationId.
module.exports = (sequelize, DataTypes) => {
  class Plan extends Model {
    static associate(models) {
      Plan.hasMany(models.Subscription, { foreignKey: "planId" });
    }
  }

  Plan.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      name: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      priceIdr: { type: DataTypes.INTEGER, allowNull: false },
      maxWarehouses: { type: DataTypes.INTEGER, allowNull: false },
      maxProducts: { type: DataTypes.INTEGER, allowNull: false },
      maxMembers: { type: DataTypes.INTEGER, allowNull: false },
    },
    { sequelize, modelName: "Plan", tableName: "Plans" },
  );

  return Plan;
};
