// The role matrix check (docs/06_Test_Plan.md, E2-09). For one registry entry it calls the
// endpoint once per role, expecting what helpers/permissions.js says, and RETURNS failure messages
// like the cross-tenant harness does. The expectations come from the permission table, so a new
// endpoint is covered by adding its registry entry, with no new test.
const { allowedRoles, labelOf, TENANT_ROLES } = require("./registry");
const { ACTIONS } = require("../../helpers/permissions");
const { send, validBody, fail, expectStatus } = require("./harness");
const { assignWarehouse } = require("./factories");

// A request the role would be fully entitled to make, as far as the role alone is concerned:
// the caller's own row for an item, a valid body for a write.
async function ownRequest(entry, world, role) {
  const id = entry.kind === "item" ? (await entry.createRow(world, "A")).id : undefined;
  return { id, authorization: world.users.A[role].authorization, body: await validBody(entry, world) };
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
    } else if (
      ACTIONS[entry.action].level === "organization" &&
      !entry.warehouseScoped &&
      [401, 403].includes(res.status)
    ) {
      failures.push(fail(entry, `${role} (the matrix allows ${entry.action}): refused with ${res.status}`));
    }
  }

  const admin = await send(app, entry, {
    id: entry.kind === "item" ? (await entry.createRow(world, "A")).id : undefined,
    authorization: world.platformAdmin.authorization,
    body: await validBody(entry, world),
  });
  failures.push(...expectStatus(entry, "Platform admin", admin, 403));
  return failures;
}

// A Viewer changes nothing: every write endpoint answers a Viewer 403. Written out by hand, not
// derived from the matrix, so a wrong edit of the matrix cannot make this pass.
async function checkViewerWrites(app, entry, world) {
  if (entry.method === "get") return [];
  const res = await send(app, entry, await ownRequest(entry, world, "VIEWER"));
  return expectStatus(entry, "Viewer writing", res, 403);
}

// A Warehouse Admin and a Viewer reach only the warehouses assigned to them, for warehouse-level
// actions and for the warehouse detail. In organization A: warehouse 1 is assigned to both,
// warehouse 2 to nobody. An unassigned warehouse is 403 for them; an assigned one gives the
// answer of the matrix; the Owner reaches both.
async function checkUnassignedWarehouse(app, entry, world) {
  if (!entry.warehouseScoped) return [];
  const orgA = world.organizations.A;
  const assigned = await world.createWarehouse("A");
  const unassigned = await world.createWarehouse("A");
  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"]) {
    await assignWarehouse(orgA, world.users.A[role].id, assigned);
  }

  const failures = [];
  const ask = async (role, warehouseId) =>
    send(app, entry, {
      authorization: world.users.A[role].authorization,
      ...(await entry.warehouseScoped.request(world, warehouseId)),
    });

  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"]) {
    failures.push(...expectStatus(entry, `${role} on a warehouse that is not assigned`, await ask(role, unassigned), 403));

    const res = await ask(role, assigned);
    if (!allowedRoles(entry).includes(role)) {
      failures.push(...expectStatus(entry, `${role} (the matrix denies ${entry.action}) on an assigned warehouse`, res, 403));
    } else if ([401, 403].includes(res.status)) {
      failures.push(fail(entry, `${role} on an assigned warehouse: refused with ${res.status}`));
    }
  }
  for (const warehouseId of [assigned, unassigned]) {
    const res = await ask("OWNER", warehouseId);
    if ([401, 403].includes(res.status)) failures.push(fail(entry, `OWNER on an active warehouse: refused with ${res.status}`));
  }
  return failures;
}

module.exports = { checkRoleMatrix, checkViewerWrites, checkUnassignedWarehouse, ownRequest };
