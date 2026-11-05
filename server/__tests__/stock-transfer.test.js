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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST /api/stock/transfers as `role` of `org`, with a fresh key unless one is given (`key: null` sends none).
const transfer = (body, { role = "OWNER", org = "A", key } = {}) => {
  let req = request(app).post("/api/stock/transfers").set("Authorization", as(role, org));
  if (key !== null) req = req.set("Idempotency-Key", key ?? crypto.randomUUID());
  return req.send(body);
};
const quantityOf = async (warehouseId, productId) =>
  (await sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0]?.quantity;
const count = async (table) => Number((await sql(`SELECT count(*) AS n FROM "${table}"`))[0].n);
const archive = (table, id) => sql(`UPDATE "${table}" SET "archivedAt" = now() WHERE id = :id`, { id });

// A source with `stock` units of one product, an empty destination, all in organization A.
async function fixture(stock = 10) {
  const fromWarehouseId = await world.createWarehouse("A");
  const toWarehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  if (stock > 0) await createStockLevel(orgA(), fromWarehouseId, productId, stock);
  return { fromWarehouseId, toWarehouseId, productId };
}
const bodyOf = (f, quantity = 3, extra = {}) => ({ fromWarehouseId: f.fromWarehouseId, toWarehouseId: f.toWarehouseId, items: [{ productId: f.productId, quantity }], ...extra });

describe("POST /api/stock/transfers: success", () => {
  it("answers 201 with the immutable data of the transfer", async () => {
    const f = await fixture();

    const res = await transfer(bodyOf(f, 3, { note: "  untuk cabang  " }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID_V4),
      code: "MT-0001",
      fromWarehouseId: f.fromWarehouseId,
      toWarehouseId: f.toWarehouseId,
      items: [{ productId: f.productId, quantity: 3 }],
      note: "untuk cabang",
      createdAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(res.body.createdAt))).toBe(false);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
  });

  it("moves the stock and writes TRANSFER_OUT and TRANSFER_IN with the same transferId", async () => {
    const f = await fixture();

    const res = await transfer(bodyOf(f, 4));

    expect([await quantityOf(f.fromWarehouseId, f.productId), await quantityOf(f.toWarehouseId, f.productId)]).toEqual([6, 4]);
    const rows = await sql(`SELECT type, "warehouseId", "quantityDelta", "transferId", "createdById" FROM "StockMovements" ORDER BY "quantityDelta"`);
    expect(rows).toEqual([
      { type: "TRANSFER_OUT", warehouseId: f.fromWarehouseId, quantityDelta: -4, transferId: res.body.id, createdById: world.users.A.OWNER.id },
      { type: "TRANSFER_IN", warehouseId: f.toWarehouseId, quantityDelta: 4, transferId: res.body.id, createdById: world.users.A.OWNER.id },
    ]);
  });

  it("never puts a stock balance in the answer", async () => {
    const f = await fixture(100);
    const res = await transfer(bodyOf(f, 1));
    expect(Object.keys(res.body).sort()).toEqual(["code", "createdAt", "fromWarehouseId", "id", "items", "note", "toWarehouseId"]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(["productId", "quantity"]);
  });

  it("returns the items ordered by product ID, whatever the order sent, and numbers transfers in turn", async () => {
    const f = await fixture();
    const other = await world.createProduct("A");
    await createStockLevel(orgA(), f.fromWarehouseId, other, 10);
    const items = [{ productId: f.productId, quantity: 1 }, { productId: other, quantity: 2 }];

    const first = await transfer({ ...bodyOf(f), items });
    const second = await transfer({ ...bodyOf(f), items: [...items].reverse() });

    expect(first.body.items.map((i) => i.productId)).toEqual([f.productId, other].sort());
    expect(second.body.items).toEqual(first.body.items);
    expect([first.body.code, second.body.code]).toEqual(["MT-0001", "MT-0002"]);
  });

  it("stores an empty note as null and a missing note as null", async () => {
    const f = await fixture();
    const empty = await transfer(bodyOf(f, 1, { note: "   " }));
    const missing = await transfer(bodyOf(f, 1));
    expect([empty.body.note, missing.body.note]).toEqual([null, null]);
  });

  it("lets a Warehouse Admin transfer from an assigned source to a destination that is not assigned", async () => {
    const f = await fixture();
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, f.fromWarehouseId);

    const res = await transfer(bodyOf(f, 2), { role: "WAREHOUSE_ADMIN" });

    expect(res.status).toBe(201);
    expect((await sql(`SELECT "createdById" FROM "StockTransfers"`))[0].createdById).toBe(world.users.A.WAREHOUSE_ADMIN.id);
  });

  it("accepts the quantity limits 1 and 1,000,000 and exactly 50 items", async () => {
    const f = await fixture(1000000);
    expect((await transfer(bodyOf(f, 1))).status).toBe(201);
    expect((await transfer(bodyOf(f, 999999))).status).toBe(201);

    const items = [];
    for (let i = 0; i < 50; i += 1) {
      const productId = await world.createProduct("A");
      await createStockLevel(orgA(), f.toWarehouseId, productId, 1);
      items.push({ productId, quantity: 1 });
    }
    const res = await transfer({ fromWarehouseId: f.toWarehouseId, toWarehouseId: f.fromWarehouseId, items });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(50);
  });
});

describe("POST /api/stock/transfers: 400 VALIDATION_ERROR", () => {
  const cases = [
    ["source equal to destination", (f) => ({ ...bodyOf(f), toWarehouseId: f.fromWarehouseId }), "toWarehouseId"],
    ["no items", (f) => ({ ...bodyOf(f), items: [] }), "items"],
    ["a duplicate product", (f) => ({ ...bodyOf(f), items: [{ productId: f.productId, quantity: 1 }, { productId: f.productId, quantity: 2 }] }), "items.1.productId"],
    ["quantity 0", (f) => bodyOf(f, 0), "items.0.quantity"],
    ["quantity 1,000,001", (f) => bodyOf(f, 1000001), "items.0.quantity"],
    ["a fractional quantity", (f) => bodyOf(f, 1.5), "items.0.quantity"],
    ["a quantity sent as a string", (f) => bodyOf(f, "3"), "items.0.quantity"],
    ["a note of 256 characters", (f) => bodyOf(f, 1, { note: "x".repeat(256) }), "note"],
    ["a malformed warehouse ID", (f) => ({ ...bodyOf(f), fromWarehouseId: "abc" }), "fromWarehouseId"],
    ["a malformed product ID", (f) => ({ ...bodyOf(f), items: [{ productId: "abc", quantity: 1 }] }), "items.0.productId"],
  ];

  it.each(cases)("refuses %s and writes nothing", async (_name, make, path) => {
    const f = await fixture();

    const res = await transfer(make(f));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.map((d) => d.path)).toContain(path);
    expect(res.body.details.every((d) => d.source === "body")).toBe(true);
    expect(await count("StockTransfers")).toBe(0);
    expect(await count("StockMovements")).toBe(0);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
  });

  it("refuses more than 50 items", async () => {
    const f = await fixture();
    const items = Array.from({ length: 51 }, (_, i) => ({ productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    const res = await transfer({ ...bodyOf(f), items });
    expect([res.status, res.body.details[0].path]).toEqual([400, "items"]);
  });

  it("refuses an unknown field, organizationId included, at the top and inside an item", async () => {
    const f = await fixture();
    const top = await transfer(bodyOf(f, 1, { organizationId: world.organizations.B }));
    const item = await transfer({ ...bodyOf(f), items: [{ productId: f.productId, quantity: 1, warehouseId: f.toWarehouseId }] });
    expect(top.status).toBe(400);
    expect(top.body.details.map((d) => d.path)).toContain("organizationId");
    expect(item.status).toBe(400);
    expect(await count("StockTransfers")).toBe(0);
  });

  it("refuses a missing or malformed Idempotency-Key before it reads the body", async () => {
    for (const key of [null, "not-a-uuid", ""]) {
      const res = await transfer({ nonsense: true }, { key });
      expect(res.status).toBe(400);
      expect(res.body.details[0]).toMatchObject({ source: "header", path: "Idempotency-Key" });
    }
    expect(await count("StockTransfers")).toBe(0);
  });
});

describe("POST /api/stock/transfers: 401 and 403 (the source warehouse)", () => {
  it("answers 401 without a token", async () => {
    const f = await fixture();
    const res = await request(app).post("/api/stock/transfers").set("Idempotency-Key", crypto.randomUUID()).send(bodyOf(f));
    expect(res.status).toBe(401);
  });

  it("answers 403 to a Viewer and to the platform admin, even for a valid body, and changes nothing", async () => {
    const f = await fixture();
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, f.fromWarehouseId);
    const viewer = await transfer(bodyOf(f), { role: "VIEWER" });
    expect([viewer.status, viewer.body.code]).toEqual([403, "FORBIDDEN"]);
    const platform = await request(app).post("/api/stock/transfers").set("Authorization", world.platformAdmin.authorization).set("Idempotency-Key", crypto.randomUUID()).send(bodyOf(f));
    expect(platform.status).toBe(403);
    expect(await count("StockTransfers")).toBe(0);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
  });

  it("answers the same 403 body for an unassigned, archived, foreign or missing source", async () => {
    const f = await fixture();
    const archived = await world.createWarehouse("A");
    await archive("Warehouses", archived);
    const foreign = await world.createWarehouse("B");

    const answers = [
      await transfer({ ...bodyOf(f), fromWarehouseId: f.fromWarehouseId }, { role: "WAREHOUSE_ADMIN" }), // active but not assigned
      await transfer({ ...bodyOf(f), fromWarehouseId: archived }),
      await transfer({ ...bodyOf(f), fromWarehouseId: foreign }),
      await transfer({ ...bodyOf(f), fromWarehouseId: RANDOM_UUID }),
    ];

    expect(answers.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
    expect(answers[0].body.code).toBe("FORBIDDEN");
    expect(await count("StockTransfers")).toBe(0);
  });

  it("checks the role before the body: a Viewer sending nonsense gets 403, not 400", async () => {
    const res = await transfer({ nonsense: true }, { role: "VIEWER" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/stock/transfers: 404 for a destination or a product that is foreign or missing", () => {
  it("answers the same 404 body for a destination of organization B and one that does not exist", async () => {
    const f = await fixture();
    const foreign = await world.createWarehouse("B");

    const withForeign = await transfer({ ...bodyOf(f), toWarehouseId: foreign });
    const withMissing = await transfer({ ...bodyOf(f), toWarehouseId: RANDOM_UUID });

    expect([withForeign.status, withMissing.status]).toEqual([404, 404]);
    expect(withForeign.text).toBe(withMissing.text);
    expect(withForeign.body.code).toBe("NOT_FOUND");
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
    expect(await count("StockTransfers")).toBe(0);
  });

  it("answers the same 404 body for a product of organization B and one that does not exist", async () => {
    const f = await fixture();
    const foreign = await world.createProduct("B");

    const withForeign = await transfer({ ...bodyOf(f), items: [{ productId: foreign, quantity: 1 }] });
    const withMissing = await transfer({ ...bodyOf(f), items: [{ productId: RANDOM_UUID, quantity: 1 }] });

    expect([withForeign.status, withMissing.status]).toEqual([404, 404]);
    expect(withForeign.text).toBe(withMissing.text);
  });

  it("is the same 404 body for a foreign destination and a foreign product", async () => {
    const f = await fixture();
    const destination = await transfer({ ...bodyOf(f), toWarehouseId: await world.createWarehouse("B") });
    const product = await transfer({ ...bodyOf(f), items: [{ productId: await world.createProduct("B"), quantity: 1 }] });
    expect(destination.text).toBe(product.text);
  });
});

describe("POST /api/stock/transfers: 409 CONFLICT", () => {
  it("refuses an archived destination", async () => {
    const f = await fixture();
    await archive("Warehouses", f.toWarehouseId);
    const res = await transfer(bodyOf(f));
    expect([res.status, res.body.code]).toEqual([409, "CONFLICT"]);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
    expect(await count("StockTransfers")).toBe(0);
  });

  it("refuses an archived product", async () => {
    const f = await fixture();
    await archive("Products", f.productId);
    const res = await transfer(bodyOf(f));
    expect([res.status, res.body.code]).toEqual([409, "CONFLICT"]);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
  });

  it("refuses a source that was archived after the caller was authorized (the race), with 409", async () => {
    const f = await fixture(0);
    // Another transaction holds the source row, archives it, and commits only after the request is waiting.
    const holder = await db.sequelize.transaction();
    await db.sequelize.query(`SELECT id FROM "Warehouses" WHERE id = :id FOR UPDATE`, { replacements: { id: f.fromWarehouseId }, transaction: holder });
    await db.sequelize.query(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { replacements: { id: f.fromWarehouseId }, transaction: holder });

    const pending = transfer(bodyOf(f)).then((res) => res);
    await sleep(300);
    await holder.commit();
    const res = await pending;

    expect([res.status, res.body.code]).toEqual([409, "CONFLICT"]);
    expect(await count("StockTransfers")).toBe(0);
  });

  it("refuses a destination total above 2,147,483,647", async () => {
    const f = await fixture();
    await createStockLevel(orgA(), f.toWarehouseId, f.productId, 2147483647);
    const res = await transfer(bodyOf(f, 1));
    expect([res.status, res.body.code]).toEqual([409, "CONFLICT"]);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(10);
  });

  it("answers 409 INSUFFICIENT_STOCK with the productId of the first item the source cannot cover, and cancels everything", async () => {
    const f = await fixture(5);
    const second = await world.createProduct("A");
    await createStockLevel(orgA(), f.fromWarehouseId, second, 5);
    const [first, last] = [f.productId, second].sort();

    const res = await transfer({ ...bodyOf(f), items: [{ productId: last, quantity: 9 }, { productId: first, quantity: 2 }] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { productId: last } });
    expect([await quantityOf(f.fromWarehouseId, first), await quantityOf(f.fromWarehouseId, last)]).toEqual([5, 5]);
    expect(await quantityOf(f.toWarehouseId, first)).toBeUndefined();
    expect(await count("StockMovements")).toBe(0);
    expect(await count("StockTransfers")).toBe(0);
    expect(await count("IdempotencyKeys")).toBe(0);
  });

  it("refuses one unit more than the source holds and a product the source never held", async () => {
    const f = await fixture(5);
    const none = await world.createProduct("A");
    expect((await transfer(bodyOf(f, 6))).body.code).toBe("INSUFFICIENT_STOCK");
    const res = await transfer({ ...bodyOf(f), items: [{ productId: none, quantity: 1 }] });
    expect(res.body).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { productId: none } });
  });
});

describe("POST /api/stock/transfers: idempotency (BL14)", () => {
  it("answers a repeated key with the same body and Idempotency-Replayed: true, and moves the stock once", async () => {
    const f = await fixture();
    const key = crypto.randomUUID();

    const first = await transfer(bodyOf(f, 3), { key });
    const second = await transfer(bodyOf(f, 3), { key });

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.text).toBe(first.text);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(await count("StockTransfers")).toBe(1);
    expect(await count("StockMovements")).toBe(2);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(7);
  });

  it("returns the first answer even when the repeated body differs (the body is not compared)", async () => {
    const f = await fixture();
    const key = crypto.randomUUID();
    const first = await transfer(bodyOf(f, 3), { key });
    const second = await transfer(bodyOf(f, 9), { key });
    expect(second.body).toEqual(first.body);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(7);
  });

  it("makes ten simultaneous sends of one key one transfer with one answer", async () => {
    const f = await fixture();
    const key = crypto.randomUUID();

    const responses = await Promise.all(Array.from({ length: 10 }, () => transfer(bodyOf(f, 2), { key })));

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await count("StockTransfers")).toBe(1);
    expect(await quantityOf(f.fromWarehouseId, f.productId)).toBe(8);
  });

  it("stores no key for a failed attempt, so the same key can be sent again", async () => {
    const f = await fixture(1);
    const key = crypto.randomUUID();
    expect((await transfer(bodyOf(f, 5), { key })).status).toBe(409);
    await sql(`UPDATE "StockLevels" SET quantity = 5 WHERE "warehouseId" = :w AND "productId" = :p`, { w: f.fromWarehouseId, p: f.productId });

    const retry = await transfer(bodyOf(f, 5), { key });

    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();
  });

  it("keeps the keys of two organizations apart", async () => {
    const f = await fixture();
    const key = crypto.randomUUID();
    const g = { fromWarehouseId: await world.createWarehouse("B"), toWarehouseId: await world.createWarehouse("B"), productId: await world.createProduct("B") };
    await createStockLevel(world.organizations.B, g.fromWarehouseId, g.productId, 10);

    const a = await transfer(bodyOf(f, 1), { key });
    const b = await transfer(bodyOf(g, 1), { key, org: "B" });

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers["idempotency-replayed"]).toBeUndefined();
    expect(a.body.id).not.toBe(b.body.id);
  });

  it("answers 403, not the stored answer, to a repeated key from a user who lost the source warehouse", async () => {
    const f = await fixture();
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, f.fromWarehouseId);
    const key = crypto.randomUUID();
    expect((await transfer(bodyOf(f, 1), { role: "WAREHOUSE_ADMIN", key })).status).toBe(201);
    await sql(`DELETE FROM "UserWarehouses" WHERE "userId" = :id`, { id: world.users.A.WAREHOUSE_ADMIN.id });

    // The source is out of reach now: the controller refuses before the key is looked at (ADR 0012).
    const res = await transfer(bodyOf(f, 1), { role: "WAREHOUSE_ADMIN", key });

    expect(res.status).toBe(403);
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
  });
});
