const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Product extends Model {
    static associate(models) {
      Product.belongsTo(models.Organization, { foreignKey: "organizationId" });
    }
  }

  Product.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      organizationId: { type: DataTypes.UUID, allowNull: false },
      sku: { type: DataTypes.STRING(50), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      unit: {
        type: DataTypes.ENUM("bks", "ktk", "pcs", "btl", "jrg", "pak"),
        allowNull: false,
      },
      minStock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      archivedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, modelName: "Product", tableName: "Products" },
  );

  return Product;
};
