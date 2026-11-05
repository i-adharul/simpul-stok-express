const crypto = require("crypto");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel, assignWarehouse } = require("./support/factories");
const { send, quantityOf, movementRows, keyRows, sql } = require("./support/stockProof");

jest.setTimeout(60000);

// BL14 across the stock endpoints. Every stock write is one row of ENDPOINTS: add the transfer and
// the import commit here when they exist (E5, E7), and each of the proofs below runs on them too.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const ENDPOINTS = [
  {
    name: "receive",
    path: "/api/stock/receive",
    body: (p) => ({ warehouseId: p.warehouseId, productId: p.productId, quantity: 7 }),
    // A body that fails with a business error (409) after the request was authorized.
    failing: (p) => ({ warehouseId: p.warehouseId, productId: p.archivedProductId, quantity: 7 }),
    effect: 7,
  },
  {
    name: "adjust",
    path: "/api/stock/adjust",
    body: (p) => ({ warehouseId: p.warehouseId, productId: p.productId, mode: "DELTA", value: 7, reason: "CORRECTION" }),
    failing: (p) => ({ warehouseId: p.warehouseId, productId: p.productId, mode: "DELTA", value: -1000, reason: "LOST" }),
    effect: 7,
  },
];

// A warehouse, a product with 10 units, and an archived product (for the receipt that must fail).
async function fixture() {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  const archivedProductId = await world.createProduct("A");
  await sql(`UPDATE "Products" SET "archivedAt" = now() WHERE id = :id`, { id: archivedProductId });
  await createStockLevel(world.organizations.A, warehouseId, productId, 10);
  return { warehouseId, productId, archivedProductId };
}

describe.each(ENDPOINTS)("BL14 on $name", (endpoint) => {
  const post = (body, options) => send(app, world, endpoint.path, body, options);

  it("has one effect and an identical answer for the same key; only the repeat carries Idempotency-Replayed", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();

    const first = await post(endpoint.body(p), { key });
    const second = await post(endpoint.body(p), { key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.text).toBe(first.text);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10 + endpoint.effect);
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(1);
    expect(await keyRows()).toBe(1);
  });

  it("does not compare the body of the repeat", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();
    const first = await post(endpoint.body(p), { key });
    const second = await post({ ...endpoint.body(p), quantity: 999, value: 999 }, { key }).catch((e) => e);
    // A different body with the same key is a replay, unless it is invalid on its own (then it is a 400 first).
    expect([201, 400]).toContain(second.status);
    if (second.status === 201) expect(second.text).toBe(first.text);
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(1);
  });

  it("has one effect when five requests with the same key arrive at once", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();

    const responses = await Promise.all(Array.from({ length: 5 }, () => post(endpoint.body(p), { key })));

    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(responses.map((r) => r.text)).size).toBe(1);
    expect(responses.filter((r) => r.headers["idempotency-replayed"] === "true")).toHaveLength(4);
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10 + endpoint.effect);
    expect(await keyRows()).toBe(1);
  });

  it("makes separate effects for different keys", async () => {
    const p = await fixture();
    await post(endpoint.body(p));
    await post(endpoint.body(p));
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10 + 2 * endpoint.effect);
    expect(await keyRows()).toBe(2);
  });

  it("stores no key for a request that failed, so the same key works later", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();
    const failed = await post(endpoint.failing(p), { key });
    expect(failed.status).toBe(409);
    expect(await keyRows()).toBe(0);

    const retry = await post(endpoint.body(p), { key });
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();
  });

  it("stores no key for a request rejected before the work (bad header, bad body, forbidden)", async () => {
    const p = await fixture();
    expect((await post(endpoint.body(p), { key: null })).status).toBe(400);
    expect((await post(endpoint.body(p), { key: "not-a-uuid" })).status).toBe(400);
    expect((await post({ ...endpoint.body(p), extra: 1 })).status).toBe(400);
    expect((await post(endpoint.body(p), { role: "VIEWER" })).status).toBe(403);
    expect(await keyRows()).toBe(0);
  });

  it("treats the same UUID in capitals as the same key", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();
    await post(endpoint.body(p), { key });
    const again = await post(endpoint.body(p), { key: key.toUpperCase() });
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(await movementRows(p.warehouseId, p.productId)).toHaveLength(1);
  });

  it("is scoped to the organization: the same key in organization B is a different key", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();
    await post(endpoint.body(p), { key });
    const warehouseB = await world.createWarehouse("B");
    const productB = await world.createProduct("B");
    await createStockLevel(world.organizations.B, warehouseB, productB, 10);

    const res = await post(endpoint.body({ warehouseId: warehouseB, productId: productB }), { key, organization: "B" });

    expect(res.status).toBe(201);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(res.body.warehouseId).toBe(warehouseB);
  });

  it("authorizes again: a user who lost the warehouse gets 403, a Viewer gets 403 even when the key exists", async () => {
    const p = await fixture();
    await assignWarehouse(world.organizations.A, world.users.A.WAREHOUSE_ADMIN.id, p.warehouseId);
    const key = crypto.randomUUID();
    await post(endpoint.body(p), { key, role: "WAREHOUSE_ADMIN" });

    expect((await post(endpoint.body(p), { key, role: "VIEWER" })).status).toBe(403);
    await sql(`DELETE FROM "UserWarehouses" WHERE "warehouseId" = :id`, { id: p.warehouseId });
    const lost = await post(endpoint.body(p), { key, role: "WAREHOUSE_ADMIN" });
    expect(lost.status).toBe(403);
    expect(lost.headers["idempotency-replayed"]).toBeUndefined();
  });
});

describe("BL14 across endpoints", () => {
  it("does not share a key between two endpoints", async () => {
    const p = await fixture();
    const key = crypto.randomUUID();
    const a = await send(app, world, ENDPOINTS[0].path, ENDPOINTS[0].body(p), { key });
    const b = await send(app, world, ENDPOINTS[1].path, ENDPOINTS[1].body(p), { key });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers["idempotency-replayed"]).toBeUndefined();
    expect(await quantityOf(p.warehouseId, p.productId)).toBe(10 + 7 + 7);
    expect(await keyRows()).toBe(2);
  });

  it("keeps each endpoint's key row pointing at its own movement", async () => {
    const p = await fixture();
    const a = await send(app, world, ENDPOINTS[0].path, ENDPOINTS[0].body(p));
    const b = await send(app, world, ENDPOINTS[1].path, ENDPOINTS[1].body(p));
    const rows = await sql(`SELECT endpoint, "resourceId" FROM "IdempotencyKeys" ORDER BY endpoint`);
    expect(rows).toEqual([
      { endpoint: "POST /api/stock/adjust", resourceId: b.body.id },
      { endpoint: "POST /api/stock/receive", resourceId: a.body.id },
    ]);
  });
});
