// The cross-tenant registry: one entry per HTTP method of every tenant endpoint
// (docs/06_Test_Plan.md, "Registering a new endpoint"). The harness (support/harness.js) reads it and
// attacks each entry from organization A's session with organization B's data. A story that adds a
// tenant route adds its entry in the same pull request; a test fails when a route is missing.
//
// An entry:
//   method        "get" | "post" | "put" | "patch" | "delete"
//   path          the URL as called, with ":id" for the row, e.g. "/api/warehouses/:id"
//                 (the part after "/api" must equal the path declared in the router)
//   kind          "item" (addressed by one row's ID) | "list" | "create"
//   action        an action of helpers/permissions.js; the roles that may call it come from there
//   createRow     async (world, "A" | "B") => { id, ... }: makes a row in that organization
//   readRow       async (id) => the row as it is in the database, or null (raw SQL)
//   body          optional (world) => a valid body for a write (also the base of foreignBodies)
//   countRows     async (organizationId) => how many rows the endpoint's table holds for it
//                 (needed for "create" entries and for idempotent ones)
//   supportsCursor  optional true: a list that takes a cursor; `cursorParam` names it (default "cursor")
//   idempotent    optional true: the endpoint needs an Idempotency-Key
//   foreignBodies optional [{ key, body: (world, id) => a body whose `key` holds `id` }]
//
// There are no tenant endpoints yet; the first entries arrive with the warehouse API (E3-01).
const { ACTIONS } = require("../../helpers/permissions");

const TENANT_ENDPOINTS = [];

const METHODS = ["get", "post", "put", "patch", "delete"];
const KINDS = ["item", "list", "create"];
const TENANT_ROLES = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"];

// "GET /warehouses/:id": the label the route inspector gives (no "/api" prefix).
const labelOf = (entry) => `${entry.method.toUpperCase()} ${entry.path.replace(/^\/api/, "")}`;

// The tenant roles that may perform the entry's action, derived from the permission matrix, so the
// harness and the application cannot disagree about it.
const allowedRoles = (entry) => TENANT_ROLES.filter((role) => ACTIONS[entry.action].roles.includes(role));

// Returns a list of problems (empty = fine), so a bad entry is reported with all its faults at once.
function validateEntry(entry) {
  const problems = [];
  if (!METHODS.includes(entry.method)) problems.push("method must be one of get, post, put, patch, delete");
  if (typeof entry.path !== "string" || !entry.path.startsWith("/api/")) problems.push('path must start with "/api/"');
  if (!KINDS.includes(entry.kind)) problems.push("kind must be item, list or create");
  if (!Object.hasOwn(ACTIONS, entry.action)) problems.push("action must be an action of helpers/permissions.js");
  if (typeof entry.createRow !== "function") problems.push("createRow is required");
  if (typeof entry.readRow !== "function") problems.push("readRow is required");

  const hasId = typeof entry.path === "string" && entry.path.includes(":id");
  if (entry.kind === "item" && !hasId) problems.push('an item entry needs ":id" in its path');
  if (entry.kind !== "item" && hasId) problems.push('only an item entry may have ":id" in its path');
  if (entry.kind === "list" && entry.method !== "get") problems.push("a list entry must use get");
  if (entry.kind === "create" && entry.method !== "post") problems.push("a create entry must use post");
  if (entry.kind === "item" && entry.method === "post") problems.push("an item entry cannot use post");
  if (entry.supportsCursor && entry.kind !== "list") problems.push("supportsCursor only fits a list entry");
  if ((entry.kind === "create" || entry.idempotent) && typeof entry.countRows !== "function") {
    problems.push("countRows is required for a create entry and for an idempotent one");
  }
  if (entry.idempotent && entry.method === "get") problems.push("a get entry cannot be idempotent");
  if (entry.foreignBodies) {
    if (!Array.isArray(entry.foreignBodies) || entry.foreignBodies.some((f) => !f.key || typeof f.body !== "function")) {
      problems.push("foreignBodies must be a list of { key, body(world, id) }");
    }
  }
  return problems;
}

module.exports = { TENANT_ENDPOINTS, TENANT_ROLES, labelOf, allowedRoles, validateEntry };
