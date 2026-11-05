const express = require("express");
const app = require("../app");
const { ACTIONS } = require("../helpers/permissions");
const { requireCan } = require("../middlewares/authorization");
const { listRoutes } = require("./support/routeInspector");
const { TENANT_ENDPOINTS } = require("./support/registry");

// An action in the permission table that no route uses is a rule nobody enforces, or a route that
// was forgotten. An action counts as used when a route installs requireCan(action) (organization
// level) or when a registry entry names it (warehouse-level actions are checked in the handler, so
// the registry is where they show up).
//
// Actions whose first route is still to come, with the story that adds it. The list only shrinks:
// the test fails when an action listed here is used (remove it) and when an action is unused but
// not listed (add the route, or list it with a reason).
const PLANNED = {
  "product.read": "E3-04 product API",
  "product.manage": "E3-04 product API",
  "member.manage": "E3-07 warehouse assignment",
  "subscription.manage": "billing endpoints (M2, E8)",
  "transfer.destinations": "E5-06 transfer destinations endpoint",
  "stock.read": "E4-06 GET /api/stock",
  "history.read": "E4-07 GET /api/stock/movements",
  "stock.receive": "E4-02 POST /api/stock/receive",
  "stock.adjust": "E4-04 POST /api/stock/adjust",
  "stock.transfer": "E5-04 POST /api/stock/transfers",
};

function usedActions(expressApp, endpoints) {
  const fromRoutes = listRoutes(expressApp).flatMap((route) => route.actions);
  const fromRegistry = endpoints.map((entry) => entry.action);
  return new Set([...fromRoutes, ...fromRegistry]);
}

// Returns the problems (empty = consistent) for a permission table, an app, a registry and the planned list.
function consistencyProblems(actions, expressApp, endpoints, planned) {
  const used = usedActions(expressApp, endpoints);
  const problems = [];
  for (const action of Object.keys(actions)) {
    if (!used.has(action) && !(action in planned)) problems.push(`${action} is used by no route and is not planned`);
    if (used.has(action) && action in planned) problems.push(`${action} is used now: remove it from PLANNED`);
  }
  for (const action of Object.keys(planned)) {
    if (!(action in actions)) problems.push(`${action} is planned but is not an action of the permission table`);
  }
  for (const action of used) {
    if (!(action in actions)) problems.push(`${action} is used by a route but is not in the permission table`);
  }
  return problems.sort();
}

describe("every action of the permission table is used by at least one route", () => {
  it("holds for the real app and the registry", () => {
    expect(consistencyProblems(ACTIONS, app, TENANT_ENDPOINTS, PLANNED)).toEqual([]);
  });

  it("every planned action names the story that will add its route", () => {
    for (const reason of Object.values(PLANNED)) expect(reason).toMatch(/E\d+|M2/);
  });
});

describe("the consistency check itself", () => {
  const handler = (req, res) => res.end();
  const table = { "a.read": {}, "a.write": {} };

  it("reports an action that no route uses and that is not planned", () => {
    const fake = express();
    fake.get("/x", requireCan_("a.read"), handler);

    expect(consistencyProblems(table, fake, [], {})).toEqual(["a.write is used by no route and is not planned"]);
  });

  it("counts requireCan on a route and a registry entry as use", () => {
    const fake = express();
    fake.get("/x", requireCan_("a.read"), handler);

    expect(consistencyProblems(table, fake, [{ action: "a.write" }], {})).toEqual([]);
  });

  it("does not count requireCan placed after the controller (the route inspector only looks before it)", () => {
    const fake = express();
    fake.get("/x", handler, requireCan_("a.read"));

    expect(consistencyProblems(table, fake, [{ action: "a.write" }], {})).toEqual([
      "a.read is used by no route and is not planned",
    ]);
  });

  it("reports a planned action that is already used, and a planned action that does not exist", () => {
    const fake = express();
    fake.get("/x", requireCan_("a.read"), handler);

    expect(consistencyProblems(table, fake, [{ action: "a.write" }], { "a.read": "E9-01", "a.gone": "E9-02" })).toEqual([
      "a.gone is planned but is not an action of the permission table",
      "a.read is used now: remove it from PLANNED",
    ]);
  });

  it("reports an action used by a route that the table does not know", () => {
    expect(consistencyProblems(table, express(), [{ action: "a.read" }, { action: "a.write" }, { action: "b.new" }], {})).toEqual([
      "b.new is used by a route but is not in the permission table",
    ]);
  });
});

// requireCan only accepts actions of the real table, so the tests use a stand-in with the same marker.
function requireCan_(action) {
  const middleware = (req, res, next) => next();
  middleware.action = action;
  return middleware;
}

describe("the real requireCan carries the marker the check reads", () => {
  it("sets .action on the middleware it returns", () => {
    expect(requireCan("warehouse.manage").action).toBe("warehouse.manage");
  });

  it("is found by the route inspector on a real route", () => {
    const fake = express();
    fake.post("/x", requireCan("warehouse.manage"), (req, res) => res.end());

    expect(listRoutes(fake)[0].actions).toEqual(["warehouse.manage"]);
  });
});
