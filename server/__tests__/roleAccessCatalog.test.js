const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, assignWarehouse } = require("./support/factories");

jest.setTimeout(120000);

// The role table of the warehouse and product endpoints, written out by hand from docs/04 (not
// derived from helpers/permissions.js), so a wrong edit of the permission table cannot make these
// tests agree with it. The registry-driven tests (roleMatrix.test.js) check the app against the
// table; these check the table against the documentation.
//
// Each row: [label, who may call it, how to build the request]. A role not listed gets 403.
const ALL = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"];
const OWNER = ["OWNER"];

const ENDPOINTS = [
  ["GET /api/warehouses", ALL, (ids) => ({ method: "get", url: "/api/warehouses" })],
  ["GET /api/warehouses/:id (assigned)", ALL, (ids) => ({ method: "get", url: `/api/warehouses/${ids.warehouse}` })],
  [
    "POST /api/warehouses",
    OWNER,
    () => ({ method: "post", url: "/api/warehouses", body: { code: `N-${Math.random().toString(36).slice(2, 8)}`, name: "Baru" } }),
  ],
  ["PATCH /api/warehouses/:id", OWNER, (ids) => ({ method: "patch", url: `/api/warehouses/${ids.warehouse}`, body: { name: "Ubah" } })],
  ["GET /api/warehouses/:id/members", OWNER, (ids) => ({ method: "get", url: `/api/warehouses/${ids.warehouse}/members` })],
  ["PUT /api/warehouses/:id/members", OWNER, (ids) => ({ method: "put", url: `/api/warehouses/${ids.warehouse}/members`, body: { userIds: [] } })],
  ["GET /api/products", ALL, () => ({ method: "get", url: "/api/products" })],
  ["GET /api/products/:id", ALL, (ids) => ({ method: "get", url: `/api/products/${ids.product}` })],
  [
    "POST /api/products",
    OWNER,
    () => ({ method: "post", url: "/api/products", body: { sku: `N-${Math.random().toString(36).slice(2, 8)}`, name: "Baru", unit: "pcs" } }),
  ],
  ["PATCH /api/products/:id", OWNER, (ids) => ({ method: "patch", url: `/api/products/${ids.product}`, body: { name: "Ubah" } })],
];

let world;
let ids;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ids = { warehouse: await world.createWarehouse("A"), product: await world.createProduct("A") };
  // Assigned, so the answer for a Warehouse Admin or Viewer is decided by the role alone.
  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"]) await assignWarehouse(world.organizations.A, world.users.A[role].id, ids.warehouse);
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const call = (spec, authorization) => {
  let req = request(app)[spec.method](spec.url);
  if (authorization) req = req.set("Authorization", authorization);
  return spec.body === undefined ? req : req.send(spec.body);
};

describe.each(ENDPOINTS)("%s", (_label, allowed, build) => {
  it.each(ALL)("%s", async (role) => {
    const res = await call(build(ids), world.users.A[role].authorization);

    if (allowed.includes(role)) expect([401, 403]).not.toContain(res.status);
    else {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
  });

  it("answers 403 to a platform admin and 401 without a token", async () => {
    expect((await call(build(ids), world.platformAdmin.authorization)).status).toBe(403);
    expect((await call(build(ids))).status).toBe(401);
  });

  it("refuses a role without the right before the body or the ID is looked at", async () => {
    const denied = ALL.filter((role) => !allowed.includes(role));
    const spec = build(ids);
    // Garbage in the body and an ID of nothing: the answer must still be 403, never 400 or 404.
    const probe = { ...spec, url: spec.url.replace(/[0-9a-f-]{36}/, "33333333-3333-4333-8333-333333333333"), body: spec.body === undefined ? undefined : { nonsense: true } };
    for (const role of denied) {
      expect((await call(probe, world.users.A[role].authorization)).status).toBe(403);
    }
  });
});

describe("a Warehouse Admin and a Viewer reach only the warehouses assigned to them", () => {
  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("%s: 200 for an assigned warehouse, 403 for one that is not", async (role) => {
    const other = await world.createWarehouse("A");
    const get = (id) => request(app).get(`/api/warehouses/${id}`).set("Authorization", world.users.A[role].authorization);

    expect((await get(ids.warehouse)).status).toBe(200);
    expect((await get(other)).status).toBe(403);
  });
});
