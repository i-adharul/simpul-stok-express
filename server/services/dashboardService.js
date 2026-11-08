const { Op, fn, col } = require("sequelize");
const { wibDayRange } = require("../helpers/wibDay");
const { tenant } = require("../helpers/tenantScope");
const { STATUS_FILTERS } = require("./stockSummaryService");

// The dashboard (S04, BL16). Read-only: no transaction and no lock, a figure that is one write
// behind is fine. Every figure except `totalProducts` covers only the caller's warehouses
// (ctx.warehouseIds: all active ones for an Owner, the assigned ones for the others).

const reachable = (ctx) => ({ warehouseId: { [Op.in]: ctx.warehouseIds } });

// tenantScope filters the main model only, not an include (ADR 0011), so the joined products are
// filtered by organization here. Archived products are left out of the low and out counts.
const activeProduct = (ctx) => ({
  association: "Product",
  required: true,
  where: { organizationId: ctx.organizationId, archivedAt: null },
  attributes: [],
});

const countPairs = (ctx, status) =>
  tenant(ctx).StockLevel.count({ where: { [Op.and]: [reachable(ctx), STATUS_FILTERS[status]()] }, include: [activeProduct(ctx)] });

// The units of every stock row of the caller's warehouses, archived products included. SUM comes
// back as a string (bigint) or null (no rows): it is turned into a plain number here.
async function sumUnits(ctx) {
  const [row] = await tenant(ctx).StockLevel.findAll({
    where: reachable(ctx),
    attributes: [[fn("COALESCE", fn("SUM", col("quantity")), 0), "total"]],
    raw: true,
  });
  return Number(row.total);
}

// A transfer writes two movements, so it counts twice (docs/04). `now` can be given by a test.
const movementsOn = (ctx, now) => {
  const { from, to } = wibDayRange(now);
  return tenant(ctx).StockMovement.count({ where: { [Op.and]: [reachable(ctx), { createdAt: { [Op.gte]: from, [Op.lt]: to } }] } });
};

// Returns `summary` of GET /api/dashboard.
async function getSummary(ctx, now = new Date()) {
  const [totalProducts, totalUnits, lowCount, outCount, movementsToday] = await Promise.all([
    tenant(ctx).Product.count({ where: { archivedAt: null } }),
    sumUnits(ctx),
    countPairs(ctx, "LOW"),
    countPairs(ctx, "OUT"),
    movementsOn(ctx, now),
  ]);
  return { totalProducts, totalUnits, lowCount, outCount, movementsToday };
}

module.exports = { getSummary };
