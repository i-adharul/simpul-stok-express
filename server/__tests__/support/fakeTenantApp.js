// A small test-only Express app that behaves like a correctly scoped tenant endpoint, with switches
// that add ONE deliberate flaw each. The harness self-test (harness.selftest.test.js) uses it to
// prove that the harness fails when it should. It uses the real authentication and requireCan; the
// rows live in memory, because only the routing and the answers are under test.
const crypto = require("crypto");
const express = require("express");
const authentication = require("../../middlewares/authentication");
const { requireCan } = require("../../middlewares/authorization");
const { errorHandler } = require("../../middlewares/errorHandler");
const { forbidden, notFound, validationError } = require("../../helpers/errors");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildFakeApp(flaws = {}) {
  const rows = [];
  const store = {
    rows,
    add: (organizationId, name = "thing") => {
      const row = { id: crypto.randomUUID(), organizationId, name };
      rows.push(row);
      return { ...row };
    },
    find: (id) => {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    count: (organizationId) => rows.filter((r) => r.organizationId === organizationId).length,
  };

  // Flaw "noAuthentication": the route forgets authentication and answers for an anonymous caller.
  const authenticate = flaws.noAuthentication
    ? (req, res, next) => {
        req.ctx = { userId: null, organizationId: null, role: "OWNER", warehouseIds: [] };
        next();
      }
    : authentication;
  // Flaw "noRoleCheck": the route forgets the role check.
  const guard = (action) => (flaws.noRoleCheck ? (req, res, next) => next() : requireCan(action));

  // Own row, or the same 404 as for a missing row. Flaw "foreign403" answers 403 for another
  // organization's row, which tells the caller that the row exists.
  function findOwn(req) {
    const id = req.params.id;
    if (!UUID.test(id)) throw notFound();
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound();
    if (row.organizationId !== req.ctx.organizationId) {
      if (flaws.foreign403) throw forbidden();
      if (flaws.foreignMessage) throw notFound("Data milik organisasi lain.");
      if (flaws.updatesForeign && req.method === "PATCH") row.name = req.body.name;
      throw notFound();
    }
    return row;
  }

  // Unknown keys are rejected (400), like validate does. Flaw "trustsBodyOrg" skips this and
  // believes the organizationId of the body.
  function readBody(body, allowed) {
    const extra = Object.keys(body ?? {}).filter((key) => !allowed.includes(key));
    if (extra.length > 0 && !flaws.trustsBodyOrg && !flaws.patchMovesRow) throw validationError({ unknown: extra });
    return body ?? {};
  }

  const router = express.Router();
  // The list belongs to the caller's organization. Flaw "listLeaks" returns every row, flaw
  // "trustsQueryOrg" believes ?organizationId=, flaw "cursorLeaks" finds the cursor row in any
  // organization and returns it.
  router.get("/things", authenticate, guard("warehouse.read"), (req, res) => {
    const organizationId = flaws.trustsQueryOrg ? (req.query.organizationId ?? req.ctx.organizationId) : req.ctx.organizationId;
    let visible = flaws.listLeaks ? [...rows] : rows.filter((r) => r.organizationId === organizationId);
    if (req.query.cursor) {
      const pool = flaws.cursorLeaks ? rows : visible;
      const at = pool.findIndex((r) => r.id === req.query.cursor);
      visible = at === -1 ? [] : (flaws.cursorLeaks ? pool : visible).slice(flaws.cursorLeaks ? at : at + 1);
    }
    res.json({ data: visible });
  });
  router.get("/things/:id", authenticate, guard("warehouse.read"), (req, res) => {
    res.json({ data: findOwn(req) });
  });
  router.patch("/things/:id", authenticate, guard("warehouse.manage"), express.json(), (req, res) => {
    const body = readBody(req.body, ["name"]);
    const row = findOwn(req);
    row.name = body.name;
    // Flaw "patchMovesRow": believes an organizationId from the body and moves the row.
    if (flaws.patchMovesRow && body.organizationId) row.organizationId = body.organizationId;
    res.json({ data: row });
  });

  // Create. `parentId` is a foreign key to another thing: it must be the caller's own, looked up,
  // so a foreign id is a 404 like a random one. Flaw "parentLeak" accepts any existing row.
  router.post("/things", authenticate, guard("warehouse.manage"), express.json(), (req, res) => {
    const body = readBody(req.body, ["name", "parentId"]);
    if (body.parentId !== undefined) {
      const parent = UUID.test(body.parentId) && rows.find((r) => r.id === body.parentId);
      if (!parent || (parent.organizationId !== req.ctx.organizationId && !flaws.parentLeak)) throw notFound();
    }
    const organizationId = flaws.trustsBodyOrg ? (body.organizationId ?? req.ctx.organizationId) : req.ctx.organizationId;
    res.status(201).json({ data: store.add(organizationId, body.name ?? "thing") });
  });

  const app = express();
  app.use("/api", router);
  app.use(errorHandler);
  return { app, store };
}

// The registry entries for the fake endpoints, bound to one fake app's store.
function fakeEntries(store) {
  const createRow = async (world, organization) => store.add(world.organizations[organization]);
  const readRow = async (id) => store.find(id);
  return {
    read: { method: "get", path: "/api/things/:id", kind: "item", action: "warehouse.read", createRow, readRow },
    patch: {
      method: "patch",
      path: "/api/things/:id",
      kind: "item",
      action: "warehouse.manage",
      createRow,
      readRow,
      body: () => ({ name: "Baru" }),
    },
    list: {
      method: "get",
      path: "/api/things",
      kind: "list",
      action: "warehouse.read",
      createRow,
      readRow,
      supportsCursor: true,
    },
    create: {
      method: "post",
      path: "/api/things",
      kind: "create",
      action: "warehouse.manage",
      createRow,
      readRow,
      body: () => ({ name: "Baru" }),
      countRows: async (organizationId) => store.count(organizationId),
      foreignBodies: [{ key: "parentId", body: (world, id) => ({ name: "Anak", parentId: id }) }],
    },
  };
}

module.exports = { buildFakeApp, fakeEntries };
