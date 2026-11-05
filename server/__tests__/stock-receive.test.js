const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createProduct, createStockLevel, assignWarehouse } = require("./support/factories");

jest.setTimeout(60000);

let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const orgA = () => world.organizations.A;
const as = (role, org = "A") => world.users[org][role].authorization;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";

// POST /api/stock/receive as `role` of organization A, with a fresh key unless one is given
// (`key: null` sends none).
const receive = (body, { role = "OWNER", key } = {}) => {
  let req = request(app).post("/api/stock/receive").set("Authorization", as(role));
  if (key !== null) req = req.set("Idempotency-Key", key ?? crypto.randomUUID());
  return req.send(body);
};
const levels = (warehouseId, productId) =>
  sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId });
const movements = (organizationId = orgA()) => sql(`SELECT * FROM "StockMovements" WHERE "organizationId" = :organizationId ORDER BY "createdAt"`, { organizationId });
const keyCount = async () => Number((await sql(`SELECT count(*) AS n FROM "IdempotencyKeys"`))[0].n);
const archive = (table, id) => sql(`UPDATE "${table}" SET "archivedAt" = now() WHERE id = :id`, { id });

async function fixture() {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  return { warehouseId, productId };
}

describe("POST /api/stock/receive: success", () => {
  it("answers 201 with the immutable data of the new RECEIVE movement", async () => {
    const { warehouseId, productId } = await fixture();

    const res = await receive({ warehouseId, productId, quantity: 25 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.stringMatching(UUID_V4), warehouseId, productId, quantity: 25, createdAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    const [movement] = await movements();
    expect(movement).toMatchObject({
      id: res.body.id,
      warehouseId,
      productId,
      type: "RECEIVE",
      quantityDelta: 25,
      reason: null,
      note: null,
      createdById: world.users.A.OWNER.id,
    });
  });

  it("never puts the current stock in the answer (a replay must equal the first answer)", async () => {
    const { warehouseId, productId } = await fixture();
    await createStockLevel(orgA(), warehouseId, productId, 100);

    const res = await receive({ warehouseId, productId, quantity: 5 });

    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "id", "productId", "quantity", "warehouseId"]);
    expect(res.body.quantity).toBe(5);
  });

  it("creates the stock row of the pair when it is missing", async () => {
    const { warehouseId, productId } = await fixture();
    expect(await levels(warehouseId, productId)).toHaveLength(0);

    await receive({ warehouseId, productId, quantity: 40 });

    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 40 }]);
  });

  it("adds to the stock row that exists", async () => {
    const { warehouseId, productId } = await fixture();
    await createStockLevel(orgA(), warehouseId, productId, 10);

    await receive({ warehouseId, productId, quantity: 15 });
    await receive({ warehouseId, productId, quantity: 1 });

    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 26 }]);
    expect(await movements()).toHaveLength(2);
  });

  it("stores the note on the movement, trimmed, and null when it is empty", async () => {
    const { warehouseId, productId } = await fixture();

    await receive({ warehouseId, productId, quantity: 1, note: "  PO-2026-001  " });
    await receive({ warehouseId, productId, quantity: 1, note: "   " });
    await receive({ warehouseId, productId, quantity: 1, note: "" });

    expect((await movements()).map((m) => m.note)).toEqual(["PO-2026-001", null, null]);
  });

  it("lets a Warehouse Admin receive into an assigned warehouse", async () => {
    const { warehouseId, productId } = await fixture();
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, warehouseId);

    const res = await receive({ warehouseId, productId, quantity: 3 }, { role: "WAREHOUSE_ADMIN" });

    expect(res.status).toBe(201);
    expect((await movements())[0].createdById).toBe(world.users.A.WAREHOUSE_ADMIN.id);
  });

  it("accepts the limits 1 and 1,000,000", async () => {
    const { warehouseId, productId } = await fixture();
    expect((await receive({ warehouseId, productId, quantity: 1 })).status).toBe(201);
    expect((await receive({ warehouseId, productId, quantity: 1000000 })).status).toBe(201);
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 1000001 }]);
  });

  it("keeps every unit when ten receipts with different keys arrive at once", async () => {
    const { warehouseId, productId } = await fixture();

    const responses = await Promise.all(Array.from({ length: 10 }, () => receive({ warehouseId, productId, quantity: 5 })));

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 50 }]);
    expect(await movements()).toHaveLength(10);
  });
});

describe("POST /api/stock/receive: validation (400)", () => {
  it.each([
    ["quantity 0", { quantity: 0 }],
    ["quantity 1,000,001", { quantity: 1000001 }],
    ["a negative quantity", { quantity: -5 }],
    ["a fractional quantity", { quantity: 1.5 }],
    ["a quantity sent as a string", { quantity: "5" }],
    ["a missing quantity", { quantity: undefined }],
    ["a note over 255 characters", { quantity: 1, note: "x".repeat(256) }],
    ["a note that is not a string", { quantity: 1, note: 5 }],
    ["warehouseId that is not a UUID", { quantity: 1, warehouseId: "abc" }],
    ["productId that is not a UUID", { quantity: 1, productId: "abc" }],
    ["an unknown field", { quantity: 1, extra: true }],
    ["organizationId in the body", { quantity: 1, organizationId: RANDOM_UUID }],
  ])("rejects %s and writes nothing", async (_name, patch) => {
    const { warehouseId, productId } = await fixture();

    const res = await receive({ warehouseId, productId, ...patch });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(await movements()).toHaveLength(0);
    expect(await levels(warehouseId, productId)).toHaveLength(0);
  });

  it("accepts a note of exactly 255 characters", async () => {
    const { warehouseId, productId } = await fixture();
    expect((await receive({ warehouseId, productId, quantity: 1, note: "x".repeat(255) })).status).toBe(201);
  });

  it("answers 400 for a missing or malformed Idempotency-Key", async () => {
    const { warehouseId, productId } = await fixture();
    for (const key of [null, "not-a-uuid"]) {
      const res = await receive({ warehouseId, productId, quantity: 1 }, { key });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ source: "header", path: "Idempotency-Key", message: expect.any(String) }]);
    }
    expect(await movements()).toHaveLength(0);
  });
});

describe("POST /api/stock/receive: who may receive where (403)", () => {
  // One body for every refusal: the caller cannot tell "not yours" from "not there".
  const refusal = async (warehouseId, productId, options) => {
    const res = await receive({ warehouseId, productId, quantity: 1 }, options);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    return res.text;
  };

  it("refuses a Viewer, even for an assigned warehouse", async () => {
    const { warehouseId, productId } = await fixture();
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, warehouseId);
    await refusal(warehouseId, productId, { role: "VIEWER" });
    expect(await movements()).toHaveLength(0);
  });

  it("refuses a Platform admin", async () => {
    const { warehouseId, productId } = await fixture();
    const res = await request(app)
      .post("/api/stock/receive")
      .set("Authorization", world.platformAdmin.authorization)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ warehouseId, productId, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it("gives a Warehouse Admin, an archived, a foreign and a missing warehouse the same 403 body", async () => {
    const { warehouseId, productId } = await fixture();
    const archived = await world.createWarehouse("A");
    await archive("Warehouses", archived);
    const foreign = await world.createWarehouse("B");
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, archived);

    const bodies = [
      await refusal(warehouseId, productId, { role: "WAREHOUSE_ADMIN" }), // exists, not assigned
      await refusal(archived, productId, { role: "OWNER" }),
      await refusal(archived, productId, { role: "WAREHOUSE_ADMIN" }), // assigned, but archived
      await refusal(foreign, productId, { role: "OWNER" }),
      await refusal(RANDOM_UUID, productId, { role: "OWNER" }),
    ];

    expect(new Set(bodies).size).toBe(1);
    expect(await movements()).toHaveLength(0);
    expect(await movements(world.organizations.B)).toHaveLength(0);
  });

  it("judges the warehouse before the product: a foreign warehouse with a missing product is 403, not 404", async () => {
    const foreign = await world.createWarehouse("B");
    await refusal(foreign, RANDOM_UUID, { role: "OWNER" });
  });

  it("judges the role before the header: a Viewer without a key gets 403", async () => {
    const { warehouseId, productId } = await fixture();
    const res = await receive({ warehouseId, productId, quantity: 1 }, { role: "VIEWER", key: null });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/stock/receive: the product (404, 409)", () => {
  it("answers 404 with one body for a product of another organization and for one that does not exist", async () => {
    const { warehouseId } = await fixture();
    const foreign = await world.createProduct("B");

    const foreignRes = await receive({ warehouseId, productId: foreign, quantity: 1 });
    const missingRes = await receive({ warehouseId, productId: RANDOM_UUID, quantity: 1 });

    expect(foreignRes.status).toBe(404);
    expect(foreignRes.body.code).toBe("NOT_FOUND");
    expect(foreignRes.text).toBe(missingRes.text);
    expect(await movements()).toHaveLength(0);
    expect(await levels(warehouseId, foreign)).toHaveLength(0);
  });

  it("answers 409 CONFLICT for an archived product and writes nothing", async () => {
    const { warehouseId, productId } = await fixture();
    await archive("Products", productId);

    const res = await receive({ warehouseId, productId, quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await movements()).toHaveLength(0);
    expect(await levels(warehouseId, productId)).toHaveLength(0);
  });
});

describe("POST /api/stock/receive: the column limit (409)", () => {
  const MAX = 2147483647;

  it("answers 409 when the new quantity would pass 2,147,483,647, and changes nothing", async () => {
    const { warehouseId, productId } = await fixture();
    await createStockLevel(orgA(), warehouseId, productId, MAX - 5);

    const res = await receive({ warehouseId, productId, quantity: 6 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: MAX - 5 }]);
    expect(await movements()).toHaveLength(0);
    expect(await keyCount()).toBe(0);
  });

  it("accepts a receipt that reaches the limit exactly", async () => {
    const { warehouseId, productId } = await fixture();
    await createStockLevel(orgA(), warehouseId, productId, MAX - 5);

    expect((await receive({ warehouseId, productId, quantity: 5 })).status).toBe(201);
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: MAX }]);
  });
});

describe("POST /api/stock/receive: idempotency (BL14)", () => {
  it("has one effect when the same key is sent twice, and the replay equals the first answer", async () => {
    const { warehouseId, productId } = await fixture();
    const key = crypto.randomUUID();

    const first = await receive({ warehouseId, productId, quantity: 7 }, { key });
    const second = await receive({ warehouseId, productId, quantity: 7 }, { key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.text).toBe(first.text);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 7 }]);
    expect(await movements()).toHaveLength(1);
    expect(await keyCount()).toBe(1);
  });

  it("has one effect when five requests with the same key arrive at once", async () => {
    const { warehouseId, productId } = await fixture();
    const key = crypto.randomUUID();

    const responses = await Promise.all(Array.from({ length: 5 }, () => receive({ warehouseId, productId, quantity: 4 }, { key })));

    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 4 }]);
    expect(await movements()).toHaveLength(1);
  });

  it("treats a different key as a separate receipt", async () => {
    const { warehouseId, productId } = await fixture();
    await receive({ warehouseId, productId, quantity: 7 });
    await receive({ warehouseId, productId, quantity: 7 });
    expect(await levels(warehouseId, productId)).toEqual([{ quantity: 14 }]);
  });

  it("stores no key for a request that failed, so the same key can be sent again", async () => {
    const { warehouseId, productId } = await fixture();
    await archive("Products", productId);
    const key = crypto.randomUUID();
    expect((await receive({ warehouseId, productId, quantity: 1 }, { key })).status).toBe(409);
    expect(await keyCount()).toBe(0);

    const other = await createProduct(orgA(), "SKU-OK");
    expect((await receive({ warehouseId, productId: other, quantity: 1 }, { key })).status).toBe(201);
  });

  it("does not let another organization replay the key", async () => {
    const { warehouseId, productId } = await fixture();
    const key = crypto.randomUUID();
    await receive({ warehouseId, productId, quantity: 7 }, { key });

    const warehouseB = await world.createWarehouse("B");
    const productB = await world.createProduct("B");
    const res = await request(app)
      .post("/api/stock/receive")
      .set("Authorization", as("OWNER", "B"))
      .set("Idempotency-Key", key)
      .send({ warehouseId: warehouseB, productId: productB, quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(res.body.warehouseId).toBe(warehouseB);
  });

  it("gives a user who lost access to the warehouse 403, not the stored answer", async () => {
    const { warehouseId, productId } = await fixture();
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, warehouseId);
    const key = crypto.randomUUID();
    await receive({ warehouseId, productId, quantity: 7 }, { role: "WAREHOUSE_ADMIN", key });
    await sql(`DELETE FROM "UserWarehouses" WHERE "warehouseId" = :warehouseId`, { warehouseId });

    const res = await receive({ warehouseId, productId, quantity: 7 }, { role: "WAREHOUSE_ADMIN", key });

    expect(res.status).toBe(403);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
  });
});
