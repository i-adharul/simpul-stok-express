const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Subscription extends Model {
    static associate(models) {
      Subscription.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      Subscription.belongsTo(models.Plan, { foreignKey: "planId" });
    }
  }

  Subscription.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false, unique: true },
      planId: { type: DataTypes.UUID, allowNull: false },
      billingDay: { type: DataTypes.INTEGER, allowNull: true },
      currentPeriodStart: { type: DataTypes.DATE, allowNull: false },
      currentPeriodEnd: { type: DataTypes.DATE, allowNull: false },
      graceUntil: { type: DataTypes.DATE, allowNull: false },
    },
    { sequelize, modelName: "Subscription", tableName: "Subscriptions" },
  );

  return Subscription;
};
