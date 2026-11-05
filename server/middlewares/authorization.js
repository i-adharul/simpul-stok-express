const { forbidden } = require("../helpers/errors");
const { can, getAction, roleAllows } = require("../helpers/permissions");

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

  function authorize(req, res, next) {
    // Authentication must come first. A missing context is a bug in the route, not a 403.
    if (!req.ctx) throw new Error("requireCan needs req.ctx: put authentication before it");
    if (!can(req.ctx, action)) return next(forbidden());
    return next();
  }

  // A marker for the consistency test (every action must be used by a route), like `isValidate`.
  authorize.action = action;
  return authorize;
}

// The role half of a WAREHOUSE-level action (for example "stock.receive"). The warehouse is in the
// body, which is read only after validation, so the handler finishes the job with
// can(req.ctx, action, { warehouseId }). This guard exists so a role that may never perform the
// action (a Viewer, a Platform admin) gets 403 before the header and the body are looked at
// (rule 2: the role check comes first), exactly like requireCan does for organization actions.
function requireRole(action) {
  if (getAction(action).level !== "warehouse") {
    throw new Error(`requireRole takes warehouse-level actions only, got: ${action}`);
  }

  function authorizeRole(req, res, next) {
    if (!req.ctx) throw new Error("requireRole needs req.ctx: put authentication before it");
    if (!roleAllows(req.ctx.role, action)) return next(forbidden());
    return next();
  }

  // The same marker as requireCan, so the "every action is used" test sees this route.
  authorizeRole.action = action;
  return authorizeRole;
}

module.exports = { requireCan, requireRole };
