// The role x action matrix (docs/02 roles, docs/04 endpoint list). This file is the single place
// that says who may do what; routes name an action, never a role, so a change is made here only.
//
// level "organization": decided by role alone, before the input is read (requireCan).
// level "warehouse": role AND the warehouse must be one of the caller's (can, in the handler,
// once the warehouseId is known).
//
// PLATFORM_ADMIN is in no list on purpose: the platform admin works on /api/platform only and
// gets 403 on every tenant action.

const ROLES = Object.freeze(["PLATFORM_ADMIN", "OWNER", "WAREHOUSE_ADMIN", "VIEWER"]);

const ALL_TENANT = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"];
const OWNER_AND_ADMIN = ["OWNER", "WAREHOUSE_ADMIN"];
const OWNER_ONLY = ["OWNER"];

const define = (level, roles) => Object.freeze({ level, roles: Object.freeze(roles) });

const ACTIONS = Object.freeze({
  // Organization level
  "warehouse.read": define("organization", ALL_TENANT),
  "product.read": define("organization", ALL_TENANT),
  "warehouse.manage": define("organization", OWNER_ONLY),
  "product.manage": define("organization", OWNER_ONLY),
  "member.manage": define("organization", OWNER_ONLY),
  "subscription.manage": define("organization", OWNER_ONLY),
  "transfer.destinations": define("organization", OWNER_AND_ADMIN),
  // Warehouse level
  "stock.read": define("warehouse", ALL_TENANT),
  "history.read": define("warehouse", ALL_TENANT),
  "stock.receive": define("warehouse", OWNER_AND_ADMIN),
  "stock.adjust": define("warehouse", OWNER_AND_ADMIN),
  "stock.transfer": define("warehouse", OWNER_AND_ADMIN),
});

// A typo in an action name must fail loudly: silently answering "no" would hide the bug as a 403.
function getAction(action) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error(`Unknown action: ${action}`);
  return ACTIONS[action];
}

// Role alone. An unknown role is denied.
const roleAllows = (role, action) => getAction(action).roles.includes(role);

module.exports = { ROLES, ACTIONS, getAction, roleAllows };
