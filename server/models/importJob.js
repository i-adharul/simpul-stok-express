const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ImportJob extends Model {
    static associate(models) {
      ImportJob.belongsTo(models.Organization, {
        foreignKey: "organizationId",
      });
      ImportJob.belongsTo(models.User, {
        foreignKey: "createdById",
        as: "createdBy",
      });
      ImportJob.hasMany(models.StockMovement, { foreignKey: "importJobId" });
    }
  }

  ImportJob.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      fileName: { type: DataTypes.STRING(255), allowNull: false },
      status: {
        type: DataTypes.ENUM("PREVIEW", "COMMITTED", "FAILED"),
        allowNull: false,
        defaultValue: "PREVIEW",
      },
      totalRows: { type: DataTypes.INTEGER, allowNull: false },
      errorRows: { type: DataTypes.INTEGER, allowNull: false },
      errorReport: { type: DataTypes.JSONB, allowNull: true },
      rows: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      createdById: { type: DataTypes.UUID, allowNull: false },
    },
    { sequelize, modelName: "ImportJob", tableName: "ImportJobs" },
  );

  return ImportJob;
};
