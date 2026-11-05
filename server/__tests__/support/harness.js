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


// ---- Part 2: organization A's session against organization B's data ----------------------------

// The role used for the attack: one that IS allowed, so only the tenant rules are under test.
const attacker = (entry, world) => world.users.A[allowedRoles(entry)[0]];

const isWrite = (entry) => entry.method !== "get";
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 4. Read, update, delete with B's ID: 404, byte-identical to the answer for an ID that does not
// exist (and for a value that is not a UUID); B's row is untouched; and the caller's own row is
// not moved to another organization by an organizationId in the body.
async function checkForeignItem(app, entry, world) {
  if (entry.kind !== "item") return [];
  const user = attacker(entry, world);
  const failures = [];
  const foreign = await entry.createRow(world, "B");
  const before = await entry.readRow(foreign.id);

  const ask = (id) => send(app, entry, { id, authorization: user.authorization, body: validBody(entry, world) });
  const [foreignRes, missingRes, notUuidRes] = [await ask(foreign.id), await ask(RANDOM_UUID), await ask("not-a-uuid")];

  failures.push(...expectStatus(entry, "B's id", foreignRes, 404));
  failures.push(...expectStatus(entry, "an id that does not exist", missingRes, 404));
  failures.push(...expectStatus(entry, "an id that is not a UUID", notUuidRes, 404));
  if (foreignRes.text !== missingRes.text) {
    failures.push(fail(entry, `B's id is not answered byte-identically to a missing id (${foreignRes.text} vs ${missingRes.text})`));
  }
  if (notUuidRes.text !== missingRes.text) {
    failures.push(fail(entry, "a value that is not a UUID is not answered byte-identically to a missing id"));
  }
  if (!sameJson(await entry.readRow(foreign.id), before)) {
    failures.push(fail(entry, "B's row was changed or removed from A's session"));
  }
  return failures;
}

// 5. List: contains A's own rows and none of B's.
async function checkList(app, entry, world) {
  if (entry.kind !== "list") return [];
  const user = attacker(entry, world);
  const own = await entry.createRow(world, "A");
  const foreign = await entry.createRow(world, "B");

  const res = await send(app, entry, { authorization: user.authorization });
  const failures = expectStatus(entry, "list", res, 200);
  if (!res.text.includes(own.id)) failures.push(fail(entry, "the list does not contain A's own row"));
  if (res.text.includes(foreign.id)) failures.push(fail(entry, "the list contains a row of B"));
  return failures;
}

// 6. A cursor that holds B's ID returns none of B's rows.
async function checkCursor(app, entry, world) {
  if (!entry.supportsCursor) return [];
  const user = attacker(entry, world);
  const foreign = await entry.createRow(world, "B");
  const second = await entry.createRow(world, "B");
  await entry.createRow(world, "A");

  const res = await send(app, entry, {
    authorization: user.authorization,
    query: { [entry.cursorParam ?? "cursor"]: foreign.id },
  });
  const failures = [];
  if (res.status >= 500) failures.push(fail(entry, `a cursor with B's id caused ${res.status}`));
  for (const row of [foreign, second]) {
    if (res.text.includes(row.id)) failures.push(fail(entry, "a cursor holding B's id returned a row of B"));
  }
  return failures;
}

// 7. organizationId in the query or the body is ignored or rejected (400); it never creates or
// moves a row in B, and never shows B's rows.
async function checkOrganizationIdInput(app, entry, world) {
  const user = attacker(entry, world);
  const orgB = world.organizations.B;
  const failures = [];
  const foreign = await entry.createRow(world, "B");
  const own = entry.kind === "item" ? await entry.createRow(world, "A") : null;
  const countBefore = entry.countRows ? await entry.countRows(orgB) : null;
  const ownBefore = own ? await entry.readRow(own.id) : null;

  const res = await send(app, entry, {
    id: own?.id,
    authorization: user.authorization,
    query: { organizationId: orgB },
    body: { ...(validBody(entry, world) ?? {}), organizationId: orgB },
  });

  if (res.status >= 500) failures.push(fail(entry, `organizationId in the query and body caused ${res.status}`));
  if (res.text.includes(foreign.id)) failures.push(fail(entry, "organizationId in the query or body showed a row of B"));
  if (entry.countRows && (await entry.countRows(orgB)) !== countBefore) {
    failures.push(fail(entry, "organizationId in the query or body created a row in B"));
  }
  if (own && !sameJson(await entry.readRow(own.id), ownBefore) && res.status === 400) {
    failures.push(fail(entry, "a rejected request still changed A's row"));
  }
  if (own && (await entry.readRow(own.id))?.organizationId !== ownBefore?.organizationId) {
    failures.push(fail(entry, "organizationId in the body moved A's row to B"));
  }
  return failures;
}

// 8. A foreign key in the body: B's id gives the same answer as a random UUID, byte-identical,
// and nothing is written in either organization.
async function checkForeignBodies(app, entry, world) {
  const failures = [];
  const user = attacker(entry, world);
  for (const { key, body } of entry.foreignBodies ?? []) {
    const foreign = await entry.createRow(world, "B");
    const id = entry.kind === "item" ? (await entry.createRow(world, "A")).id : undefined;
    const counts = async () =>
      entry.countRows ? [await entry.countRows(world.organizations.A), await entry.countRows(world.organizations.B)] : [];
    const before = await counts();

    const ask = (value) => send(app, entry, { id, authorization: user.authorization, body: body(world, value) });
    const withForeign = await ask(foreign.id);
    const withRandom = await ask(RANDOM_UUID);

    if (withForeign.status < 400 || withForeign.status >= 500) {
      failures.push(fail(entry, `${key}: B's id was not refused (status ${withForeign.status})`));
    }
    if (withForeign.status !== withRandom.status || withForeign.text !== withRandom.text) {
      failures.push(fail(entry, `${key}: B's id is not answered byte-identically to a random id`));
    }
    if (!sameJson(await counts(), before)) failures.push(fail(entry, `${key}: a refused request still wrote a row`));
  }
  return failures;
}

const CHECKS = {
  noToken: checkNoToken,
  platformAdmin: checkPlatformAdmin,
  roleWithoutRight: checkRoleWithoutRight,
  foreignItem: checkForeignItem,
  list: checkList,
  cursor: checkCursor,
  organizationIdInput: checkOrganizationIdInput,
  foreignBodies: checkForeignBodies,
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
  checkForeignItem,
  checkList,
  checkCursor,
  checkOrganizationIdInput,
  checkForeignBodies,
};
