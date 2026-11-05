// A small test-only Express app that behaves like a correctly scoped tenant endpoint, with switches
// that add ONE deliberate flaw each. The harness self-test (harness.selftest.test.js) uses it to
// prove that the harness fails when it should. It uses the real authentication and requireCan; the
// rows live in memory, because only the routing and the answers are under test.
const crypto = require("crypto");
const express = require("express");
const authentication = require("../../middlewares/authentication");
const { requireCan } = require("../../middlewares/authorization");
const { errorHandler } = require("../../middlewares/errorHandler");
const { forbidden, notFound } = require("../../helpers/errors");

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
      throw flaws.foreign403 ? forbidden() : notFound();
    }
    return row;
  }

  const router = express.Router();
  router.get("/things", authenticate, guard("warehouse.read"), (req, res) => {
    res.json({ data: rows.filter((r) => r.organizationId === req.ctx.organizationId) });
  });
  router.get("/things/:id", authenticate, guard("warehouse.read"), (req, res) => {
    res.json({ data: findOwn(req) });
  });
  router.patch("/things/:id", authenticate, guard("warehouse.manage"), express.json(), (req, res) => {
    const row = findOwn(req);
    row.name = req.body.name;
    res.json({ data: row });
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
    list: { method: "get", path: "/api/things", kind: "list", action: "warehouse.read", createRow, readRow },
  };
}

module.exports = { buildFakeApp, fakeEntries };
