const { forbidden } = require("../helpers/errors");
const { can, getAction } = require("../helpers/permissions");

// Guards one ORGANIZATION-level action (for example "warehouse.manage"). It looks at the role only
// and runs before the input is validated, so a role without the right gets 403 whatever the body
// or the ID in the URL is, also for another organization's ID (rule 2: the role check comes first).
//
// Warehouse-level actions are not guarded here: they need the warehouseId, which is only known
// after the input is read, so the handler calls can(req.ctx, action, { warehouseId }) itself.
// Asking for one here is refused when the route is defined, at start-up, not on a request.
function requireCan(action) {
  if (getAction(action).level !== "organization") {
    throw new Error(`requireCan takes organization-level actions only, got: ${action}`);
  }

  return function authorize(req, res, next) {
    // Authentication must come first. A missing context is a bug in the route, not a 403.
    if (!req.ctx) throw new Error("requireCan needs req.ctx: put authentication before it");
    if (!can(req.ctx, action)) return next(forbidden());
    return next();
  };
}

module.exports = { requireCan };
