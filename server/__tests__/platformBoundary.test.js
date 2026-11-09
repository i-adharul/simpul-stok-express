const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { EXEMPT_ROUTES, PLATFORM_ROUTES } = require("./support/exemptions");

jest.setTimeout(60000);

// The two sides of the wall (BL25): a Platform admin gets 403 on every tenant route (the registry
// ones are attacked by crossTenant.test.js; the exempt ones, which the harness skips, are here), and
// no tenant role and no anonymous caller gets into /api/platform/*, also for a path that has no endpoint.
let world;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const call = (label, authorization) => {
  const [method, path] = label.split(" ");
  const req = request(app)[method.toLowerCase()](`/api${path.replace(/:id/g, "00000000-0000-4000-8000-000000000000")}`);
  return authorization ? req.set("Authorization", authorization).send({}) : req.send({});
};

describe("a Platform admin on the tenant routes the harness does not attack", () => {
  it.each(Object.keys(EXEMPT_ROUTES))("%s answers 403", async (label) => {
    const res = await call(label, world.platformAdmin.authorization);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});

describe("/api/platform/*", () => {
  const labels = [...Object.keys(PLATFORM_ROUTES), "GET /platform/organizations", "PATCH /platform/organizations/:id/status"];

  it.each(labels)("%s: no token is 401", async (label) => {
    expect((await call(label)).status).toBe(401);
  });

  it.each(labels.flatMap((label) => ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"].map((role) => [label, role])))(
    "%s: %s gets 403 before the body or the ID is looked at",
    async (label, role) => {
      const res = await call(label, world.users.A[role].authorization);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    },
  );
});
