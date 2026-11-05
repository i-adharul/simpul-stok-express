const { findActiveWarehouseIds } = require("./userAccess");

// Which warehouses the caller may touch (BL03). An Owner works in every active warehouse of the
// organization; a Warehouse Admin or Viewer only in the ones assigned to them. A Platform admin
// has no organization, so no warehouses.
function warehouseIdsFor(user) {
  if (!user.organizationId) return Promise.resolve([]);
  if (user.role === "OWNER") return findActiveWarehouseIds(user.organizationId);
  if (user.role === "PLATFORM_ADMIN") return Promise.resolve([]);
  return findActiveWarehouseIds(user.organizationId, user.id);
}

// The request context (docs/05, decision 1). `user` is the row the authentication middleware just
// read from the database, never anything from the request, so `organizationId` cannot be forged.
async function buildContext(user) {
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    warehouseIds: await warehouseIdsFor(user),
  };
}

module.exports = { buildContext };
