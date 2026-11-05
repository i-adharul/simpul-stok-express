const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class WebhookEvent extends Model {}

  // Global (no organizationId, so no association) and never edited except processedAt,
  // so the only timestamp is receivedAt.
  WebhookEvent.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      provider: { type: DataTypes.STRING(30), allowNull: false },
      eventId: { type: DataTypes.STRING(255), allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      receivedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      processedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "WebhookEvent",
      tableName: "WebhookEvents",
      timestamps: false,
    },
  );

  return WebhookEvent;
};
