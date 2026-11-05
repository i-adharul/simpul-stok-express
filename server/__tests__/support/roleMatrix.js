// The role matrix check (docs/06_Test_Plan.md, E2-09). For one registry entry it calls the
// endpoint once per role, expecting what helpers/permissions.js says, and RETURNS failure messages
// like the cross-tenant harness does. The expectations come from the permission table, so a new
// endpoint is covered by adding its registry entry, with no new test.
const { allowedRoles, labelOf, TENANT_ROLES } = require("./registry");
const { ACTIONS } = require("../../helpers/permissions");
const { send, validBody, fail, expectStatus } = require("./harness");

// A request the role would be fully entitled to make, as far as the role alone is concerned:
// the caller's own row for an item, a valid body for a write.
async function ownRequest(entry, world, role) {
  const id = entry.kind === "item" ? (await entry.createRow(world, "A")).id : undefined;
  return { id, authorization: world.users.A[role].authorization, body: validBody(entry, world) };
}

// Every role gets the answer the matrix gives:
//  - a role without the right: 403, whatever else is true;
//  - a Platform admin: 403;
//  - a role with the right, on an ORGANIZATION-level action (decided by role alone): never 401/403.
// A role with the right on a WAREHOUSE-level action also needs the warehouse to be assigned, which
// checkUnassignedWarehouse (below) covers.
async function checkRoleMatrix(app, entry, world) {
  const failures = [];
  const allowed = allowedRoles(entry);

  for (const role of TENANT_ROLES) {
    const res = await send(app, entry, await ownRequest(entry, world, role));
    if (!allowed.includes(role)) {
      failures.push(...expectStatus(entry, `${role} (the matrix denies ${entry.action})`, res, 403));
    } else if (ACTIONS[entry.action].level === "organization" && [401, 403].includes(res.status)) {
      failures.push(fail(entry, `${role} (the matrix allows ${entry.action}): refused with ${res.status}`));
    }
  }

  const admin = await send(app, entry, {
    id: entry.kind === "item" ? (await entry.createRow(world, "A")).id : undefined,
    authorization: world.platformAdmin.authorization,
    body: validBody(entry, world),
  });
  failures.push(...expectStatus(entry, "Platform admin", admin, 403));
  return failures;
}

module.exports = { checkRoleMatrix, ownRequest };
