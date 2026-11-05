const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Organization, { foreignKey: "organizationId" });
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      passwordHash: { type: DataTypes.STRING(100), allowNull: false },
      role: {
        type: DataTypes.ENUM(
          "PLATFORM_ADMIN",
          "OWNER",
          "WAREHOUSE_ADMIN",
          "VIEWER",
        ),
        allowNull: false,
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true },
      passwordChangedAt: { type: DataTypes.DATE, allowNull: true },
      resetTokenHash: { type: DataTypes.STRING(100), allowNull: true },
      resetExpiresAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "User", tableName: "Users" },
  );

  return User;
};
