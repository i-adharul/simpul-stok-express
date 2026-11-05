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
const { can, roleAllows } = require("../../helpers/permissions");
const { getSequelize } = require("./db");

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
  // Flaw "noRoleCheck": the route forgets the role check. Flaw "refusesViewerRead": it refuses a
  // Viewer a read that the matrix allows.
  const guard = (action) => {
    if (flaws.noRoleCheck) return (req, res, next) => next();
    const check = requireCan(action);
    if (!flaws.refusesViewerRead || action !== "warehouse.read") return check;
    return (req, res, next) => (req.ctx.role === "VIEWER" ? next(forbidden()) : check(req, res, next));
  };

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

  // Idempotency (rule 9): a valid UUID key is required, and a repeated key gets the first answer
  // again with Idempotency-Replayed: true, without a second effect. Flaws: "noKeyCheck" accepts a
  // missing key, "malformedKeyAccepted" accepts any text, "noReplayHeader" forgets the header,
  // "replayCreatesAgain" does the work a second time.
  const seen = new Map();
  function idempotent(req, res, next) {
    const key = req.get("Idempotency-Key");
    const valid = flaws.malformedKeyAccepted ? Boolean(key) : UUID.test(key ?? "");
    if (!valid && !flaws.noKeyCheck) throw validationError({ header: "Idempotency-Key" });
    const slot = `${req.ctx.organizationId}:${key}`;
    if (key && seen.has(slot) && !flaws.replayCreatesAgain) {
      const first = seen.get(slot);
      if (!flaws.noReplayHeader) res.set("Idempotency-Replayed", "true");
      return res.status(first.status).type("json").send(first.text);
    }
    const send = res.send.bind(res);
    res.send = (text) => {
      if (key) seen.set(slot, { status: res.statusCode, text });
      return send(text);
    };
    return next();
  }

  // Create. `parentId` is a foreign key to another thing: it must be the caller's own, looked up,
  // so a foreign id is a 404 like a random one. Flaw "parentLeak" accepts any existing row.
  router.post("/things", authenticate, guard("warehouse.manage"), idempotent, express.json(), (req, res) => {
    const body = readBody(req.body, ["name", "parentId"]);
    if (body.parentId !== undefined) {
      const parent = UUID.test(body.parentId) && rows.find((r) => r.id === body.parentId);
      if (!parent || (parent.organizationId !== req.ctx.organizationId && !flaws.parentLeak)) throw notFound();
    }
    const organizationId = flaws.trustsBodyOrg ? (body.organizationId ?? req.ctx.organizationId) : req.ctx.organizationId;
    res.status(201).json({ data: store.add(organizationId, body.name ?? "thing") });
  });

  // Warehouse-level action: the role AND the assignment decide, in the handler, because the
  // warehouseId is only known after the body is read. Flaw "ignoresAssignment" checks the role only.
  router.post("/receive", authenticate, express.json(), (req, res) => {
    const { warehouseId } = readBody(req.body, ["warehouseId"]);
    const allowed = flaws.ignoresAssignment ? roleAllows(req.ctx.role, "stock.receive") : can(req.ctx, "stock.receive", { warehouseId });
    if (!allowed) throw forbidden();
    res.status(201).json({ data: { warehouseId } });
  });

  // Warehouse detail: any tenant role may read (organization-level), but a Warehouse Admin or a
  // Viewer only an assigned warehouse (403); the Owner gets 404 for a warehouse that is not active.
  // Flaw "detailIgnoresAssignment" lets everyone in.
  router.get("/warehouses/:id", authenticate, guard("warehouse.read"), (req, res) => {
    const inContext = req.ctx.warehouseIds.includes(req.params.id);
    if (!inContext && !flaws.detailIgnoresAssignment) {
      throw req.ctx.role === "OWNER" ? notFound() : forbidden();
    }
    res.json({ data: { id: req.params.id } });
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
    receive: {
      method: "post",
      path: "/api/receive",
      kind: "create",
      action: "stock.receive",
      createRow,
      readRow,
      body: () => ({ warehouseId: "33333333-3333-4333-8333-333333333333" }),
      countRows: async (organizationId) => store.count(organizationId),
      warehouseScoped: { request: async (world, warehouseId) => ({ body: { warehouseId } }) },
    },
    detail: {
      method: "get",
      path: "/api/warehouses/:id",
      kind: "item",
      action: "warehouse.read",
      createRow: async (world, organization) => ({ id: await world.createWarehouse(organization) }),
      readRow: async (id) =>
        (await getSequelize().query('SELECT * FROM "Warehouses" WHERE "id" = :id', { replacements: { id } }))[0][0] ?? null,
      warehouseScoped: { request: async (world, warehouseId) => ({ id: warehouseId }) },
    },
    create: {
      method: "post",
      path: "/api/things",
      kind: "create",
      action: "warehouse.manage",
      createRow,
      readRow,
      body: () => ({ name: "Baru" }),
      idempotent: true,
      countRows: async (organizationId) => store.count(organizationId),
      foreignBodies: [{ key: "parentId", body: (world, id) => ({ name: "Anak", parentId: id }) }],
    },
  };
}

module.exports = { buildFakeApp, fakeEntries };
