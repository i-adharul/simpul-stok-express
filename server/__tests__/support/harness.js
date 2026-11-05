// The cross-tenant harness (docs/06_Test_Plan.md, "Registering a new endpoint"). Each check takes
// the Express app, one registry entry and the world (support/factories.js createWorld), attacks
// the endpoint from organization A's session against organization B's data, and RETURNS a list of
// failure messages (empty = the endpoint held). Returning messages, instead of calling expect,
// lets the self-test (harness.selftest.test.js) prove that a flawed route makes the check fail.
const request = require("supertest");
const { allowedRoles, labelOf, TENANT_ROLES } = require("./registry");

const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";

const urlFor = (entry, id = RANDOM_UUID) => entry.path.replace(":id", id);

// Sends one request to the entry's endpoint. `id` fills ":id"; `body` is only sent on writes.
function send(app, entry, { id, authorization, body, query, headers = {} } = {}) {
  let req = request(app)[entry.method](urlFor(entry, id));
  if (authorization) req = req.set("Authorization", authorization);
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  if (query) req = req.query(query);
  if (body !== undefined && entry.method !== "get") req = req.send(body);
  return req;
}

// A valid body for the entry, so a 400 can never hide the answer the check is looking for.
const validBody = (entry, world) => (entry.body ? entry.body(world) : undefined);

const fail = (entry, message) => `${labelOf(entry)}: ${message}`;
const expectStatus = (entry, what, res, status) =>
  res.status === status ? [] : [fail(entry, `${what}: expected ${status} but got ${res.status}`)];

// B's row for an item entry, a random ID otherwise (a list or a create has no ID in the URL).
async function foreignId(entry, world) {
  return entry.kind === "item" ? (await entry.createRow(world, "B")).id : RANDOM_UUID;
}

// 1. No token (also a damaged one): 401.
async function checkNoToken(app, entry, world) {
  const id = await foreignId(entry, world);
  const failures = [];
  for (const [what, authorization] of [
    ["no token", undefined],
    ["a garbage token", "Bearer not.a.token"],
  ]) {
    const res = await send(app, entry, { id, authorization, body: validBody(entry, world) });
    failures.push(...expectStatus(entry, what, res, 401));
  }
  return failures;
}

// 2. A Platform admin has no organization: 403 on every tenant endpoint.
async function checkPlatformAdmin(app, entry, world) {
  const id = await foreignId(entry, world);
  const res = await send(app, entry, {
    id,
    authorization: world.platformAdmin.authorization,
    body: validBody(entry, world),
  });
  return expectStatus(entry, "Platform admin", res, 403);
}

// 3. A role without the right gets 403 BEFORE the existence check (rule 2): the same 403 for B's
// ID, for an ID that does not exist, and for an ID of its own organization.
async function checkRoleWithoutRight(app, entry, world) {
  const denied = TENANT_ROLES.filter((role) => !allowedRoles(entry).includes(role));
  const ids =
    entry.kind === "item"
      ? [(await entry.createRow(world, "B")).id, RANDOM_UUID, (await entry.createRow(world, "A")).id]
      : [undefined];
  const failures = [];
  for (const role of denied) {
    for (const id of ids) {
      const res = await send(app, entry, {
        id,
        authorization: world.users.A[role].authorization,
        body: validBody(entry, world),
      });
      failures.push(...expectStatus(entry, `${role} (not allowed) with ${id ?? "no id"}`, res, 403));
    }
  }
  return failures;
}

const CHECKS = {
  noToken: checkNoToken,
  platformAdmin: checkPlatformAdmin,
  roleWithoutRight: checkRoleWithoutRight,
};

// Runs every check that applies to the entry and returns all failure messages.
async function runChecks(app, entry, world, checks = CHECKS) {
  const failures = [];
  for (const check of Object.values(checks)) failures.push(...(await check(app, entry, world)));
  return failures;
}

module.exports = {
  RANDOM_UUID,
  CHECKS,
  runChecks,
  send,
  urlFor,
  validBody,
  foreignId,
  expectStatus,
  fail,
  checkNoToken,
  checkPlatformAdmin,
  checkRoleWithoutRight,
};
