const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.Organization, { foreignKey: "organizationId" });
      AuditLog.belongsTo(models.User, { foreignKey: "actorId", as: "actor" });
    }
  }

  // Rows are never updated (database trigger, ADR 0005), so there is no updatedAt.
  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      actorId: { type: DataTypes.UUID, allowNull: true },
      action: { type: DataTypes.STRING(100), allowNull: false },
      entityType: { type: DataTypes.STRING(50), allowNull: false },
      entityId: { type: DataTypes.UUID, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    },
    {
      sequelize,
      modelName: "AuditLog",
      tableName: "AuditLogs",
      updatedAt: false,
    },
  );

  return AuditLog;
};
