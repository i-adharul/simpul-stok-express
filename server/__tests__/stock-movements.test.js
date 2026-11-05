const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, assignWarehouse } = require("./support/factories");

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
const as = (role) => world.users.A[role].authorization;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const get = (query = {}, role = "OWNER") => request(app).get("/api/stock/movements").query(query).set("Authorization", as(role));
const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";
const T = (seconds) => new Date(Date.UTC(2026, 10, 5, 0, 0, seconds));
const ids = (res) => res.body.items.map((i) => i.id);

async function movement(warehouseId, productId, { at = T(1), type = "RECEIVE", organization = "A", createdById = null, id = crypto.randomUUID() } = {}) {
  await sql(
    `INSERT INTO "StockMovements" (id, "organizationId", "warehouseId", "productId", "quantityDelta", type, reason, "createdById", "createdAt")
     VALUES (:id, :organizationId, :warehouseId, :productId, 5, CAST(:type AS "enum_StockMovements_type"),
             CAST(:reason AS "enum_StockMovements_reason"), :createdById, :at)`,
    { id, organizationId: world.organizations[organization], warehouseId, productId, type, reason: type === "ADJUST" ? "LOST" : null, createdById, at },
  );
  return id;
}

describe("GET /api/stock/movements: list and shape", () => {
  it("answers 200 newest first with the documented fields and a null nextCursor on a short list", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const old = await movement(w, p, { at: T(1) });
    const recent = await movement(w, p, { at: T(2), type: "ADJUST", createdById: world.users.A.OWNER.id });

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(ids(res)).toEqual([recent, old]);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items[0]).toEqual({
      id: recent, warehouseId: w, productId: p, type: "ADJUST", quantityDelta: 5, reason: "LOST", note: null,
      transferId: null, createdById: world.users.A.OWNER.id, createdAt: T(2).toISOString(),
    });
  });

  it("is empty when nothing happened yet", async () => {
    expect((await get()).body).toEqual({ items: [], nextCursor: null });
  });

  it("shows what the stock endpoints wrote (receive then adjust)", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const send = (path, body) => request(app).post(path).set("Authorization", as("OWNER")).set("Idempotency-Key", crypto.randomUUID()).send(body);
    await send("/api/stock/receive", { warehouseId: w, productId: p, quantity: 10 });
    await send("/api/stock/adjust", { warehouseId: w, productId: p, mode: "DELTA", value: -3, reason: "DAMAGED" });

    const res = await get();

    expect(res.body.items.map((i) => [i.type, i.quantityDelta, i.reason])).toEqual([["ADJUST", -3, "DAMAGED"], ["RECEIVE", 10, null]]);
  });
});

describe("GET /api/stock/movements: cursor", () => {
  it("pages by 50 and returns every row once, with an opaque nextCursor until the last page", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const all = [];
    for (let n = 0; n < 120; n += 1) all.push(await movement(w, p, { at: T(n % 30) }));

    const first = await get();
    expect(first.body.items).toHaveLength(50);
    expect(typeof first.body.nextCursor).toBe("string");
    expect(first.body.nextCursor).not.toContain(first.body.items[49].id);
    const second = await get({ cursor: first.body.nextCursor });
    const third = await get({ cursor: second.body.nextCursor });

    expect(second.body.items).toHaveLength(50);
    expect(third.body.items).toHaveLength(20);
    expect(third.body.nextCursor).toBeNull();
    const seen = [...ids(first), ...ids(second), ...ids(third)];
    expect(new Set(seen).size).toBe(120);
    expect(new Set(seen)).toEqual(new Set(all));
  });

  it("keeps the filters while paging", async () => {
    const w = await world.createWarehouse("A");
    const p1 = await world.createProduct("A");
    const p2 = await world.createProduct("A");
    for (let n = 0; n < 60; n += 1) await movement(w, p1, { at: T(n) });
    for (let n = 0; n < 5; n += 1) await movement(w, p2, { at: T(100 + n) });

    const first = await get({ productId: p1 });
    const second = await get({ productId: p1, cursor: first.body.nextCursor });

    expect(first.body.items).toHaveLength(50);
    expect(second.body.items).toHaveLength(10);
    expect([...first.body.items, ...second.body.items].every((i) => i.productId === p1)).toBe(true);
  });

  it.each([
    ["text", "abc"],
    ["the id of a row", "11111111-1111-4111-8111-111111111111"],
    ["base64url that is not JSON", Buffer.from("nope").toString("base64url")],
    ["an empty cursor", ""],
  ])("answers 400 VALIDATION_ERROR for a cursor that is %s", async (_name, cursor) => {
    const res = await get({ cursor });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([{ source: "query", path: "cursor", message: expect.any(String) }]);
  });

  it("never returns a row of another organization for a cursor made by hand", async () => {
    const wb = await world.createWarehouse("B");
    const pb = await world.createProduct("B");
    const foreign = await movement(wb, pb, { organization: "B", at: T(5) });
    const cursor = Buffer.from(JSON.stringify({ t: T(10).toISOString(), i: foreign })).toString("base64url");

    const res = await get({ cursor });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(foreign);
  });
});

describe("GET /api/stock/movements: filters", () => {
  async function seed() {
    const w1 = await world.createWarehouse("A");
    const w2 = await world.createWarehouse("A");
    const p1 = await world.createProduct("A");
    const p2 = await world.createProduct("A");
    const a = await movement(w1, p1, { at: T(1), type: "RECEIVE", createdById: world.users.A.OWNER.id });
    const b = await movement(w1, p2, { at: T(2), type: "ADJUST", createdById: world.users.A.WAREHOUSE_ADMIN.id });
    const c = await movement(w2, p1, { at: T(3), type: "RECEIVE", createdById: world.users.A.OWNER.id });
    return { w1, w2, p1, p2, a, b, c };
  }

  it("filters by productId, warehouseId, type and createdById", async () => {
    const { w1, p2, a, b, c } = await seed();
    expect(ids(await get({ productId: p2 }))).toEqual([b]);
    expect(ids(await get({ warehouseId: w1 }))).toEqual([b, a]);
    expect(ids(await get({ type: "ADJUST" }))).toEqual([b]);
    expect(ids(await get({ type: "RECEIVE" }))).toEqual([c, a]);
    expect(ids(await get({ createdById: world.users.A.WAREHOUSE_ADMIN.id }))).toEqual([b]);
  });

  it("combines filters with AND", async () => {
    const { w1, p1, a } = await seed();
    expect(ids(await get({ warehouseId: w1, productId: p1, type: "RECEIVE" }))).toEqual([a]);
    expect((await get({ warehouseId: w1, type: "IMPORT" })).body.items).toEqual([]);
  });

  it("from is inclusive and to is exclusive, with offsets understood", async () => {
    const { a, b, c } = await seed();
    expect(ids(await get({ from: T(2).toISOString() }))).toEqual([c, b]);
    expect(ids(await get({ to: T(3).toISOString() }))).toEqual([b, a]);
    expect(ids(await get({ from: T(2).toISOString(), to: T(3).toISOString() }))).toEqual([b]);
    // 07:00:02 at +07:00 is the same instant as 00:00:02Z
    expect(ids(await get({ from: "2026-11-05T07:00:02+07:00", to: "2026-11-05T07:00:03+07:00" }))).toEqual([b]);
  });

  it.each([
    ["productId that is not a UUID", { productId: "abc" }],
    ["warehouseId that is not a UUID", { warehouseId: "abc" }],
    ["createdById that is not a UUID", { createdById: "abc" }],
    ["an unknown type", { type: "SELL" }],
    ["a type in lower case", { type: "receive" }],
    ["from without an offset", { from: "2026-11-05T00:00:00" }],
    ["from that is only a date", { from: "2026-11-05" }],
    ["to that is not a date", { to: "yesterday" }],
    ["page (not part of this query)", { page: "1" }],
    ["organizationId", { organizationId: RANDOM_UUID }],
  ])("answers 400 VALIDATION_ERROR for %s", async (_name, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].source).toBe("query");
  });
});

describe("GET /api/stock/movements: which warehouses", () => {
  async function twoWarehouses() {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    return { mine, other, visible: await movement(mine, p, { at: T(1) }), hidden: await movement(other, p, { at: T(2) }) };
  }

  it("shows the Owner every active warehouse", async () => {
    const { visible, hidden } = await twoWarehouses();
    expect(ids(await get())).toEqual([hidden, visible]);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("shows a %s only the movements of the assigned warehouses", async (role) => {
    const { mine, visible } = await twoWarehouses();
    await assignWarehouse(orgA(), world.users.A[role].id, mine);
    expect(ids(await get({}, role))).toEqual([visible]);
  });

  it("is empty for a Viewer without an assignment", async () => {
    await twoWarehouses();
    expect((await get({}, "VIEWER")).body).toEqual({ items: [], nextCursor: null });
  });

  it("gives an empty list, not 403, for a warehouseId out of reach (unassigned, foreign, archived, missing)", async () => {
    const { mine, other } = await twoWarehouses();
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, mine);
    const foreign = await world.createWarehouse("B");
    const archived = await world.createWarehouse("A");
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: archived });

    for (const warehouseId of [other, foreign, archived, RANDOM_UUID]) {
      const res = await get({ warehouseId }, "VIEWER");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
    }
  });

  it("hides the movements of an archived warehouse", async () => {
    const { other, visible } = await twoWarehouses();
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: other });
    expect(ids(await get())).toEqual([visible]);
  });

  it("never shows a movement of another organization", async () => {
    await twoWarehouses();
    const wb = await world.createWarehouse("B");
    const pb = await world.createProduct("B");
    const foreign = await movement(wb, pb, { organization: "B" });
    expect((await get()).text).not.toContain(foreign);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    expect((await request(app).get("/api/stock/movements")).status).toBe(401);
    expect((await request(app).get("/api/stock/movements").set("Authorization", world.platformAdmin.authorization)).status).toBe(403);
  });
});
