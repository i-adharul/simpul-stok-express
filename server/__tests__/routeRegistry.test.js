const express = require("express");
const app = require("../app");
const { TENANT_ENDPOINTS } = require("./support/registry");
const { EXEMPT_ROUTES, PUBLIC_ROUTES, PLATFORM_ROUTES } = require("./support/exemptions");
const { placementProblems } = require("./support/routeCoverage");

const real = { endpoints: TENANT_ENDPOINTS, exempt: EXEMPT_ROUTES, publicRoutes: PUBLIC_ROUTES, platformRoutes: PLATFORM_ROUTES };
const handler = (req, res) => res.end();
const entry = (method, path) => ({ method, path, kind: path.includes(":id") ? "item" : "list" });

describe("every Express route is accounted for in the cross-tenant harness", () => {
  it("each route of the real app is in exactly one place, and no list names a route that is gone", () => {
    expect(placementProblems(app, real)).toEqual([]);
  });

  it("has not gone blind: the real app has routes, and the public list names some of them", () => {
    expect(Object.keys(PUBLIC_ROUTES).length).toBeGreaterThan(0);
    expect(placementProblems(express(), { ...real })).not.toEqual([]);
  });
});

describe("the placement check itself", () => {
  const none = { endpoints: [], exempt: {}, publicRoutes: {}, platformRoutes: {} };

  it("reports a route that is in none of the places", () => {
    const fake = express();
    fake.get("/things", handler);

    expect(placementProblems(fake, none)).toEqual(["GET /things is in none of the four places"]);
  });

  it("accepts a route in the registry, in the exemptions, in the public list or in the platform list (one each)", () => {
    const fake = express();
    fake.get("/things/:id", handler);
    fake.post("/special", handler);
    fake.get("/open", handler);
    fake.get("/platform/things", handler);

    expect(
      placementProblems(fake, {
        endpoints: [entry("get", "/api/things/:id")],
        exempt: { "POST /special": "cannot be tested the normal way, because of a reason" },
        publicRoutes: { "GET /open": "not tenant data at all" },
        platformRoutes: { "GET /platform/things": "platform admin only, reads across tenants" },
      }),
    ).toEqual([]);
  });

  it("reports a route that is in more than one place", () => {
    const fake = express();
    fake.get("/things", handler);

    const problems = placementProblems(fake, {
      endpoints: [entry("get", "/api/things")],
      exempt: {},
      publicRoutes: { "GET /things": "also public by mistake" },
    });

    expect(problems).toEqual([
      "GET /things is in more than one place: TENANT_ENDPOINTS (registry.js), PUBLIC_ROUTES (exemptions.js)",
    ]);
  });

  it("reports a platform route that is also in another place, and a stale platform entry", () => {
    const fake = express();
    fake.get("/platform/things", handler);

    expect(
      placementProblems(fake, {
        endpoints: [],
        exempt: {},
        publicRoutes: { "GET /platform/things": "also public by mistake" },
        platformRoutes: { "GET /platform/things": "platform admin only", "GET /platform/gone": "stale platform entry" },
      }),
    ).toEqual([
      "GET /platform/gone is listed in PLATFORM_ROUTES (exemptions.js) but is not a route of the app",
      "GET /platform/things is in more than one place: PUBLIC_ROUTES (exemptions.js), PLATFORM_ROUTES (exemptions.js)",
    ]);
  });

  it("reports an entry whose route does not exist (a stale entry or a typo)", () => {
    const fake = express();
    fake.get("/things", handler);

    expect(
      placementProblems(fake, {
        endpoints: [entry("get", "/api/things"), entry("get", "/api/thing")],
        exempt: { "DELETE /things": "stale reason that is long enough" },
        publicRoutes: {},
      }),
    ).toEqual([
      "DELETE /things is listed in EXEMPT_ROUTES (exemptions.js) but is not a route of the app",
      "GET /thing is listed in TENANT_ENDPOINTS (registry.js) but is not a route of the app",
    ]);
  });

  it("sees routes inside a nested router, and each method separately", () => {
    const fake = express();
    const router = express.Router();
    router.get("/inner", handler);
    router.post("/inner", handler);
    fake.use("/outer", router);

    expect(placementProblems(fake, none)).toEqual([
      "GET /inner is in none of the four places",
      "POST /inner is in none of the four places",
    ]);
  });
});
