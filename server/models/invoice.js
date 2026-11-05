const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Invoice extends Model {
    static associate(models) {
      Invoice.belongsTo(models.Organization, { foreignKey: "organizationId" });
      Invoice.belongsTo(models.Subscription, { foreignKey: "subscriptionId" });
      Invoice.belongsTo(models.Plan, { foreignKey: "planId" });
    }
  }

  Invoice.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      subscriptionId: { type: DataTypes.UUID, allowNull: false },
      planId: { type: DataTypes.UUID, allowNull: false },
      number: { type: DataTypes.STRING(30), allowNull: false },
      amountIdr: { type: DataTypes.INTEGER, allowNull: false },
      kind: {
        type: DataTypes.ENUM("INITIAL", "PLAN_CHANGE", "RENEWAL"),
        allowNull: false,
      },
      periodStart: { type: DataTypes.DATE, allowNull: true },
      periodEnd: { type: DataTypes.DATE, allowNull: true },
      status: {
        type: DataTypes.ENUM("PENDING", "PAID", "EXPIRED", "FAILED"),
        allowNull: false,
        defaultValue: "PENDING",
      },
      externalId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true,
      },
      paymentUrl: { type: DataTypes.TEXT, allowNull: true },
      dueAt: { type: DataTypes.DATE, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      paidAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "Invoice", tableName: "Invoices" },
  );

  return Invoice;
};
