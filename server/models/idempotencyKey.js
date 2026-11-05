const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class IdempotencyKey extends Model {
    static associate(models) {
      IdempotencyKey.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
    }
  }

  // Only createdAt: a key row is written once and later deleted by the cleanup.
  IdempotencyKey.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      key: { type: DataTypes.UUID, allowNull: false },
      endpoint: { type: DataTypes.STRING(100), allowNull: false },
      resourceId: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: "IdempotencyKey",
      tableName: "IdempotencyKeys",
      updatedAt: false,
    },
  );

  return IdempotencyKey;
};
