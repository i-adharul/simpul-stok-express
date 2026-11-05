const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      Notification.belongsTo(models.User, { foreignKey: "userId" });
    }
  }

  Notification.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: {
        type: DataTypes.ENUM(
          "LOW_STOCK",
          "INVOICE_DUE",
          "TRIAL_ENDING",
          "SUSPENDED",
        ),
        allowNull: false,
      },
      message: { type: DataTypes.STRING(255), allowNull: false },
      readAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "Notification", tableName: "Notifications" },
  );

  return Notification;
};
