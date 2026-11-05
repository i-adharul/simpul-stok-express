const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel, assignWarehouse } = require("./support/factories");

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

// POST /api/stock/adjust as `role` of organization A, with a fresh key unless one is given
// (`key: null` sends none).
const adjust = (body, { role = "OWNER", key } = {}) => {
  let req = request(app).post("/api/stock/adjust").set("Authorization", as(role));
  if (key !== null) req = req.set("Idempotency-Key", key ?? crypto.randomUUID());
  return req.send(body);
};
const quantityOf = async (warehouseId, productId) =>
  (await sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0]?.quantity;
const movements = (organizationId = orgA()) => sql(`SELECT * FROM "StockMovements" WHERE "organizationId" = :organizationId ORDER BY "createdAt"`, { organizationId });
const keyCount = async () => Number((await sql(`SELECT count(*) AS n FROM "IdempotencyKeys"`))[0].n);
const archive = (table, id) => sql(`UPDATE "${table}" SET "archivedAt" = now() WHERE id = :id`, { id });

// A warehouse and a product of organization A, with `stock` units when it is given.
async function fixture(stock) {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  if (stock !== undefined) await createStockLevel(orgA(), warehouseId, productId, stock);
  return { warehouseId, productId };
}
const base = (f, patch = {}) => ({ warehouseId: f.warehouseId, productId: f.productId, mode: "SET", value: 10, reason: "STOCK_OPNAME", ...patch });

describe("POST /api/stock/adjust: SET and DELTA", () => {
  it("SET: writes the counted quantity and answers 201 with the SIGNED difference and the reason", async () => {
    const f = await fixture(30);

    const res = await adjust(base(f, { mode: "SET", value: 22, reason: "STOCK_OPNAME" }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID_V4),
      warehouseId: f.warehouseId,
      productId: f.productId,
      quantity: -8,
      createdAt: expect.any(String),
      reason: "STOCK_OPNAME",
    });
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(22);
    expect(await movements()).toEqual([
      expect.objectContaining({ id: res.body.id, type: "ADJUST", quantityDelta: -8, reason: "STOCK_OPNAME", note: null, createdById: world.users.A.OWNER.id }),
    ]);
  });

  it("SET above the current quantity gives a positive difference", async () => {
    const f = await fixture(5);
    const res = await adjust(base(f, { mode: "SET", value: 50, reason: "CORRECTION" }));
    expect(res.body.quantity).toBe(45);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(50);
  });

  it("DELTA: adds a positive and subtracts a negative difference", async () => {
    const f = await fixture(10);
    const up = await adjust(base(f, { mode: "DELTA", value: 7, reason: "CORRECTION" }));
    const down = await adjust(base(f, { mode: "DELTA", value: -12, reason: "DAMAGED" }));

    expect(up.body).toMatchObject({ quantity: 7, reason: "CORRECTION" });
    expect(down.body).toMatchObject({ quantity: -12, reason: "DAMAGED" });
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(5);
    expect((await movements()).map((m) => m.quantityDelta)).toEqual([7, -12]);
  });

  it("creates the stock row when it is missing (SET above 0 and DELTA above 0)", async () => {
    const a = await fixture();
    const b = await fixture();
    expect((await adjust(base(a, { mode: "SET", value: 9 }))).status).toBe(201);
    expect((await adjust(base(b, { mode: "DELTA", value: 4, reason: "CORRECTION" }))).status).toBe(201);
    expect(await quantityOf(a.warehouseId, a.productId)).toBe(9);
    expect(await quantityOf(b.warehouseId, b.productId)).toBe(4);
  });

  it("SET 0 empties a stock row (the result may be 0)", async () => {
    const f = await fixture(6);
    const res = await adjust(base(f, { mode: "SET", value: 0, reason: "LOST" }));
    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(-6);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(0);
  });

  it.each(["STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"])("accepts the reason %s and stores it on the movement", async (reason) => {
    const f = await fixture(1);
    const res = await adjust(base(f, { mode: "DELTA", value: 1, reason }));
    expect(res.status).toBe(201);
    expect((await movements())[0].reason).toBe(reason);
  });

  it("stores the note trimmed, and null when it is empty", async () => {
    const f = await fixture(0);
    await adjust(base(f, { mode: "DELTA", value: 1, note: "  rak B  " }));
    await adjust(base(f, { mode: "DELTA", value: 1, note: "   " }));
    await adjust(base(f, { mode: "DELTA", value: 1, note: "" }));
    expect((await movements()).map((m) => m.note)).toEqual(["rak B", null, null]);
  });

  it("lets a Warehouse Admin adjust an assigned warehouse", async () => {
    const f = await fixture(3);
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, f.warehouseId);
    const res = await adjust(base(f, { value: 8 }), { role: "WAREHOUSE_ADMIN" });
    expect(res.status).toBe(201);
    expect((await movements())[0].createdById).toBe(world.users.A.WAREHOUSE_ADMIN.id);
  });

  it("accepts the limits: SET 1,000,000 and DELTA -1,000,000 / +1,000,000", async () => {
    const f = await fixture(0);
    expect((await adjust(base(f, { mode: "SET", value: 1000000 }))).status).toBe(201);
    expect((await adjust(base(f, { mode: "DELTA", value: 1000000, reason: "CORRECTION" }))).status).toBe(201);
    expect((await adjust(base(f, { mode: "DELTA", value: -1000000, reason: "CORRECTION" }))).status).toBe(201);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(1000000);
  });

  it("may adjust an archived product (so leftover stock can be zeroed)", async () => {
    const f = await fixture(4);
    await archive("Products", f.productId);
    const res = await adjust(base(f, { mode: "SET", value: 0, reason: "CORRECTION" }));
    expect(res.status).toBe(201);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(0);
  });
});

describe("POST /api/stock/adjust: the result of the adjustment", () => {
  it("answers 400 when the new quantity equals the current one, and writes nothing", async () => {
    const f = await fixture(10);

    const res = await adjust(base(f, { mode: "SET", value: 10 }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([{ source: "body", path: "value", message: expect.stringMatching(/^Stok baru sama dengan stok saat ini/) }]);
    expect(await movements()).toHaveLength(0);
    expect(await keyCount()).toBe(0);
  });

  it("answers 400 for SET 0 when there is no stock row (the current quantity is 0)", async () => {
    const f = await fixture();
    const res = await adjust(base(f, { mode: "SET", value: 0 }));
    expect(res.status).toBe(400);
    expect(await quantityOf(f.warehouseId, f.productId)).toBeUndefined();
  });

  it("answers 409 CONFLICT when a DELTA would take the quantity below 0, and changes nothing", async () => {
    const f = await fixture(5);

    const res = await adjust(base(f, { mode: "DELTA", value: -6, reason: "LOST" }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(5);
    expect(await movements()).toHaveLength(0);
    expect(await keyCount()).toBe(0);
  });

  it("answers 409 for a negative DELTA on a pair that has no stock row", async () => {
    const f = await fixture();
    const res = await adjust(base(f, { mode: "DELTA", value: -1, reason: "LOST" }));
    expect(res.status).toBe(409);
    expect(await quantityOf(f.warehouseId, f.productId)).toBeUndefined();
  });

  it("allows a DELTA that takes the quantity to exactly 0", async () => {
    const f = await fixture(5);
    expect((await adjust(base(f, { mode: "DELTA", value: -5, reason: "LOST" }))).status).toBe(201);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(0);
  });

  it("answers 409 when a DELTA would pass the column limit 2,147,483,647", async () => {
    const f = await fixture(2147483647 - 5);
    const res = await adjust(base(f, { mode: "DELTA", value: 6, reason: "CORRECTION" }));
    expect(res.status).toBe(409);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(2147483647 - 5);
  });
});

describe("POST /api/stock/adjust: validation (400)", () => {
  it.each([
    ["an unknown mode", { mode: "ADD" }],
    ["a missing mode", { mode: undefined }],
    ["SET with a negative value", { mode: "SET", value: -1 }],
    ["SET above 1,000,000", { mode: "SET", value: 1000001 }],
    ["DELTA 0", { mode: "DELTA", value: 0 }],
    ["DELTA above 1,000,000", { mode: "DELTA", value: 1000001 }],
    ["DELTA below -1,000,000", { mode: "DELTA", value: -1000001 }],
    ["a fractional value", { value: 1.5 }],
    ["a value sent as a string", { value: "5" }],
    ["a missing value", { value: undefined }],
    ["a missing reason", { reason: undefined }],
    ["an unknown reason", { reason: "OTHER" }],
    ["a reason in lower case", { reason: "lost" }],
    ["a note over 255 characters", { note: "x".repeat(256) }],
    ["a note that is not a string", { note: 5 }],
    ["warehouseId that is not a UUID", { warehouseId: "abc" }],
    ["productId that is not a UUID", { productId: "abc" }],
    ["an unknown field", { extra: true }],
    ["organizationId in the body", { organizationId: RANDOM_UUID }],
  ])("rejects %s and writes nothing", async (_name, patch) => {
    const f = await fixture(10);

    const res = await adjust(base(f, patch));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(await movements()).toHaveLength(0);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(10);
  });

  it("accepts a note of exactly 255 characters", async () => {
    const f = await fixture(1);
    expect((await adjust(base(f, { value: 5, note: "x".repeat(255) }))).status).toBe(201);
  });

  it("answers 400 for a missing or malformed Idempotency-Key", async () => {
    const f = await fixture(1);
    for (const key of [null, "not-a-uuid"]) {
      const res = await adjust(base(f, { value: 5 }), { key });
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([{ source: "header", path: "Idempotency-Key", message: expect.any(String) }]);
    }
    expect(await movements()).toHaveLength(0);
  });
});

describe("POST /api/stock/adjust: who may adjust where (403, 404)", () => {
  const refusal = async (f, options, patch = {}) => {
    const res = await adjust(base(f, { value: 5, ...patch }), options);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    return res.text;
  };

  it("refuses a Viewer, even for an assigned warehouse", async () => {
    const f = await fixture(1);
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, f.warehouseId);
    await refusal(f, { role: "VIEWER" });
    expect(await movements()).toHaveLength(0);
  });

  it("refuses a Platform admin", async () => {
    const f = await fixture(1);
    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", world.platformAdmin.authorization)
      .set("Idempotency-Key", crypto.randomUUID())
      .send(base(f));
    expect(res.status).toBe(403);
  });

  it("gives an unassigned, an archived, a foreign and a missing warehouse the same 403 body", async () => {
    const f = await fixture(1);
    const archived = await world.createWarehouse("A");
    await archive("Warehouses", archived);
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, archived);
    const foreign = await world.createWarehouse("B");

    const bodies = [
      await refusal(f, { role: "WAREHOUSE_ADMIN" }), // exists, not assigned
      await refusal(f, { role: "OWNER" }, { warehouseId: archived }),
      await refusal(f, { role: "WAREHOUSE_ADMIN" }, { warehouseId: archived }), // assigned, but archived
      await refusal(f, { role: "OWNER" }, { warehouseId: foreign }),
      await refusal(f, { role: "OWNER" }, { warehouseId: RANDOM_UUID }),
    ];

    expect(new Set(bodies).size).toBe(1);
    expect(await movements()).toHaveLength(0);
    expect(await movements(world.organizations.B)).toHaveLength(0);
  });

  it("judges the warehouse before the product: a foreign warehouse with a missing product is 403", async () => {
    const foreign = await world.createWarehouse("B");
    const f = { warehouseId: foreign, productId: RANDOM_UUID };
    await refusal(f, { role: "OWNER" });
  });

  it("judges the role before the header: a Viewer without a key gets 403", async () => {
    const f = await fixture(1);
    expect((await adjust(base(f), { role: "VIEWER", key: null })).status).toBe(403);
  });

  it("answers 404 with one body for a product of another organization and for one that does not exist", async () => {
    const f = await fixture(1);
    const foreign = await world.createProduct("B");

    const foreignRes = await adjust(base(f, { productId: foreign }));
    const missingRes = await adjust(base(f, { productId: RANDOM_UUID }));

    expect(foreignRes.status).toBe(404);
    expect(foreignRes.body.code).toBe("NOT_FOUND");
    expect(foreignRes.text).toBe(missingRes.text);
    expect(await movements()).toHaveLength(0);
  });
});

describe("POST /api/stock/adjust: never negative under concurrency (BL15)", () => {
  it("lets exactly five of ten simultaneous DELTA -1 succeed on 5 units, and the stock ends at 0", async () => {
    const f = await fixture(5);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => adjust(base(f, { mode: "DELTA", value: -1, reason: "LOST" }))),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(0);
    expect(await movements()).toHaveLength(5);
  });

  it("keeps the sum right when receipts and adjustments run at once", async () => {
    const f = await fixture(0);
    const receive = () =>
      request(app)
        .post("/api/stock/receive")
        .set("Authorization", as("OWNER"))
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ warehouseId: f.warehouseId, productId: f.productId, quantity: 2 });

    const responses = await Promise.all([
      ...Array.from({ length: 5 }, receive),
      ...Array.from({ length: 5 }, () => adjust(base(f, { mode: "DELTA", value: 3, reason: "CORRECTION" }))),
    ]);

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(5 * 2 + 5 * 3);
  });
});

describe("POST /api/stock/adjust: idempotency (BL14)", () => {
  it("has one effect when the same key is sent twice, and the replay equals the first answer", async () => {
    const f = await fixture(10);
    const key = crypto.randomUUID();

    const first = await adjust(base(f, { mode: "DELTA", value: -3, reason: "DAMAGED" }), { key });
    const second = await adjust(base(f, { mode: "DELTA", value: -3, reason: "DAMAGED" }), { key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.text).toBe(first.text);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(7);
    expect(await movements()).toHaveLength(1);
    expect(await keyCount()).toBe(1);
  });

  it("has one effect when five requests with the same key arrive at once", async () => {
    const f = await fixture(10);
    const key = crypto.randomUUID();

    const responses = await Promise.all(Array.from({ length: 5 }, () => adjust(base(f, { mode: "DELTA", value: -2, reason: "LOST" }), { key })));

    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(8);
    expect(await movements()).toHaveLength(1);
  });

  it("stores no key for a request that failed, so the same key can be sent again", async () => {
    const f = await fixture(1);
    const key = crypto.randomUUID();
    expect((await adjust(base(f, { mode: "DELTA", value: -5, reason: "LOST" }), { key })).status).toBe(409);
    expect(await keyCount()).toBe(0);

    expect((await adjust(base(f, { mode: "DELTA", value: 5, reason: "CORRECTION" }), { key })).status).toBe(201);
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(6);
  });

  it("does not let another organization replay the key", async () => {
    const f = await fixture(10);
    const key = crypto.randomUUID();
    await adjust(base(f, { value: 4 }), { key });

    const warehouseB = await world.createWarehouse("B");
    const productB = await world.createProduct("B");
    const res = await request(app)
      .post("/api/stock/adjust")
      .set("Authorization", as("OWNER", "B"))
      .set("Idempotency-Key", key)
      .send({ warehouseId: warehouseB, productId: productB, mode: "SET", value: 2, reason: "STOCK_OPNAME" });

    expect(res.status).toBe(201);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(res.body.warehouseId).toBe(warehouseB);
  });

  it("does not share a key between receive and adjust (they are different endpoints)", async () => {
    const f = await fixture(0);
    const key = crypto.randomUUID();
    const received = await request(app)
      .post("/api/stock/receive")
      .set("Authorization", as("OWNER"))
      .set("Idempotency-Key", key)
      .send({ warehouseId: f.warehouseId, productId: f.productId, quantity: 3 });
    const adjusted = await adjust(base(f, { mode: "DELTA", value: 2, reason: "CORRECTION" }), { key });

    expect(received.status).toBe(201);
    expect(adjusted.status).toBe(201);
    expect(adjusted.headers["idempotency-replayed"]).toBeUndefined();
    expect(await quantityOf(f.warehouseId, f.productId)).toBe(5);
  });
});
