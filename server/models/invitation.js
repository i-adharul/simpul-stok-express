const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Invitation extends Model {
    static associate(models) {
      Invitation.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      Invitation.belongsTo(models.User, {
        foreignKey: "createdById",
        as: "createdBy",
      });
    }
  }

  Invitation.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false },
      role: {
        type: DataTypes.ENUM("WAREHOUSE_ADMIN", "VIEWER"),
        allowNull: false,
      },
      warehouseIds: {
        type: DataTypes.ARRAY(DataTypes.UUID),
        allowNull: false,
        defaultValue: [],
      },
      tokenHash: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      acceptedAt: { type: DataTypes.DATE, allowNull: true },
      createdById: { type: DataTypes.UUID, allowNull: false },
    },
    { sequelize, modelName: "Invitation", tableName: "Invitations" },
  );

  return Invitation;
};
