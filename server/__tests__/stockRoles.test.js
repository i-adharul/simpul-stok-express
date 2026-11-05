const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel, assignWarehouse } = require("./support/factories");

jest.setTimeout(60000);

// Who may call each stock endpoint, written out by hand (not derived from helpers/permissions.js),
// so a wrong edit of the permission table cannot make this pass. Warehouse 1 is assigned to the
// Warehouse Admin and to the Viewer of organization A, warehouse 2 to nobody.
let world;
let w1;
let w2;
let product;
let movementId;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  w1 = await world.createWarehouse("A");
  w2 = await world.createWarehouse("A");
  product = await world.createProduct("A");
  for (const role of ["WAREHOUSE_ADMIN", "VIEWER"]) await assignWarehouse(world.organizations.A, world.users.A[role].id, w1);
  for (const w of [w1, w2]) await createStockLevel(world.organizations.A, w, product, 10);
  const [{ id }] = (await getSequelize().query(
    `INSERT INTO "StockMovements" ("organizationId","warehouseId","productId","quantityDelta",type) VALUES (:o,:w,:p,1,'RECEIVE') RETURNING id`,
    { replacements: { o: world.organizations.A, w: w1, p: product } },
  ))[0];
  movementId = id;
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const WHO = {
  anonymous: () => undefined,
  platformAdmin: () => world.platformAdmin.authorization,
  owner: () => world.users.A.OWNER.authorization,
  adminAssigned: () => world.users.A.WAREHOUSE_ADMIN.authorization,
  viewerAssigned: () => world.users.A.VIEWER.authorization,
};

// Each endpoint: how to call it for warehouse 1 (assigned) or warehouse 2 (not assigned).
const call = (kind, who, warehouse) => {
  const auth = WHO[who]();
  const withAuth = (req) => (auth ? req.set("Authorization", auth) : req);
  const key = crypto.randomUUID();
  const w = warehouse === 1 ? w1 : w2;
  switch (kind) {
    case "receive":
      return withAuth(request(app).post("/api/stock/receive").set("Idempotency-Key", key)).send({ warehouseId: w, productId: product, quantity: 1 });
    case "adjust":
      return withAuth(request(app).post("/api/stock/adjust").set("Idempotency-Key", key)).send({ warehouseId: w, productId: product, mode: "DELTA", value: 1, reason: "CORRECTION" });
    case "stock":
      return withAuth(request(app).get("/api/stock")).query({ warehouseId: w });
    case "history":
      return withAuth(request(app).get("/api/stock/movements")).query({ warehouseId: w });
    case "detail":
      return withAuth(request(app).get(`/api/stock/movements/${movementId}`));
    default:
      throw new Error(kind);
  }
};

// [who, warehouse, expected status] per endpoint. History and detail never answer 403 for an
// unassigned warehouse: the list is empty and the detail is a 404 (the existence is not revealed).
const EXPECTED = {
  receive: [["anonymous", 1, 401], ["platformAdmin", 1, 403], ["viewerAssigned", 1, 403], ["adminAssigned", 2, 403], ["adminAssigned", 1, 201], ["owner", 1, 201], ["owner", 2, 201]],
  adjust: [["anonymous", 1, 401], ["platformAdmin", 1, 403], ["viewerAssigned", 1, 403], ["adminAssigned", 2, 403], ["adminAssigned", 1, 201], ["owner", 1, 201], ["owner", 2, 201]],
  stock: [["anonymous", 1, 401], ["platformAdmin", 1, 403], ["viewerAssigned", 2, 403], ["viewerAssigned", 1, 200], ["adminAssigned", 2, 403], ["adminAssigned", 1, 200], ["owner", 1, 200], ["owner", 2, 200]],
  history: [["anonymous", 1, 401], ["platformAdmin", 1, 403], ["viewerAssigned", 2, 200], ["viewerAssigned", 1, 200], ["adminAssigned", 1, 200], ["owner", 2, 200]],
  detail: [["anonymous", 1, 401], ["platformAdmin", 1, 403], ["viewerAssigned", 1, 200], ["adminAssigned", 1, 200], ["owner", 1, 200]],
};

describe.each(Object.entries(EXPECTED))("roles on the stock endpoint: %s", (kind, rows) => {
  it.each(rows)("%s (warehouse %p) gets %p", async (who, warehouse, status) => {
    const res = await call(kind, who, warehouse);
    expect(res.status).toBe(status);
  });
});

describe("what an unassigned caller sees in the history", () => {
  it("is an empty list for a Viewer asking for the other warehouse, and nothing of it without a filter", async () => {
    const other = await call("history", "viewerAssigned", 2);
    expect(other.body).toEqual({ items: [], nextCursor: null });
    await getSequelize().query(
      `INSERT INTO "StockMovements" ("organizationId","warehouseId","productId","quantityDelta",type) VALUES (:o,:w,:p,2,'RECEIVE')`,
      { replacements: { o: world.organizations.A, w: w2, p: product } },
    );
    const all = await request(app).get("/api/stock/movements").set("Authorization", WHO.viewerAssigned());
    expect(all.body.items.every((item) => item.warehouseId === w1)).toBe(true);
  });

  it("is a 404 for the detail of a movement in an unassigned warehouse", async () => {
    const [{ id }] = (await getSequelize().query(
      `INSERT INTO "StockMovements" ("organizationId","warehouseId","productId","quantityDelta",type) VALUES (:o,:w,:p,2,'RECEIVE') RETURNING id`,
      { replacements: { o: world.organizations.A, w: w2, p: product } },
    ))[0];
    const res = await request(app).get(`/api/stock/movements/${id}`).set("Authorization", WHO.viewerAssigned());
    expect(res.status).toBe(404);
  });
});

describe("a write by a Viewer changes nothing", () => {
  it("leaves stock, movements and keys as they were", async () => {
    const before = (await getSequelize().query(`SELECT (SELECT sum(quantity) FROM "StockLevels") AS q, (SELECT count(*) FROM "StockMovements") AS m, (SELECT count(*) FROM "IdempotencyKeys") AS k`))[0][0];
    await call("receive", "viewerAssigned", 1);
    await call("adjust", "viewerAssigned", 1);
    const after = (await getSequelize().query(`SELECT (SELECT sum(quantity) FROM "StockLevels") AS q, (SELECT count(*) FROM "StockMovements") AS m, (SELECT count(*) FROM "IdempotencyKeys") AS k`))[0][0];
    expect(after).toEqual(before);
  });
});
