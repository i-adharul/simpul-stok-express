const crypto = require("crypto");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { decodeCursor } = require("../helpers/cursor");
const { listMovements, PAGE_SIZE } = require("../services/stockHistoryService");

jest.setTimeout(60000);

let world;
let owner;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  owner = (warehouseIds) => ({ userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
// Raw insert with an exact createdAt (millisecond precision, like the application writes it).
async function movement(organization, warehouseId, productId, { at, type = "RECEIVE", delta = 5, createdById = null, id = crypto.randomUUID() } = {}) {
  await sql(
    `INSERT INTO "StockMovements" (id, "organizationId", "warehouseId", "productId", "quantityDelta", type, reason, "createdById", "createdAt")
     VALUES (:id, :organizationId, :warehouseId, :productId, :delta, CAST(:type AS "enum_StockMovements_type"),
             CAST(:reason AS "enum_StockMovements_reason"), :createdById, :at)`,
    { id, organizationId: world.organizations[organization], warehouseId, productId, delta, type, reason: type === "ADJUST" ? "CORRECTION" : null, createdById, at },
  );
  return id;
}
const T = (seconds) => new Date(Date.UTC(2026, 10, 5, 0, 0, seconds));
const ids = (result) => result.items.map((i) => i.id);

describe("stockHistoryService.listMovements", () => {
  it("lists newest first, shaped as documented", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const old = await movement("A", w, p, { at: T(1) });
    const recent = await movement("A", w, p, { at: T(2), type: "ADJUST", delta: -1 });
    const result = await listMovements(owner([w]), {});
    expect(ids(result)).toEqual([recent, old]);
    expect(result.items[0]).toEqual({
      id: recent, warehouseId: w, productId: p, type: "ADJUST", quantityDelta: -1,
      reason: "CORRECTION", note: null, transferId: null, createdById: null, createdAt: T(2),
    });
    expect(result.nextCursor).toBeNull();
  });

  it("breaks ties on the same instant by id ascending", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const [a, b, c] = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b", "00000000-0000-4000-8000-00000000000c"];
    for (const id of [c, a, b]) await movement("A", w, p, { at: T(5), id });
    expect(ids(await listMovements(owner([w]), {}))).toEqual([a, b, c]);
  });

  it("pages by 50 with a cursor, with no row lost or repeated, and nextCursor null on the last page", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const all = [];
    for (let n = 0; n < 120; n += 1) all.push(await movement("A", w, p, { at: T(n % 40) })); // many shared instants

    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const result = await listMovements(owner([w]), { cursor });
      seen.push(...ids(result));
      pages += 1;
      cursor = result.nextCursor ? decodeCursor(result.nextCursor) : undefined;
      if (result.nextCursor) expect(result.items).toHaveLength(PAGE_SIZE);
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    expect(new Set(seen)).toEqual(new Set(all));
  });

  it("gives nextCursor null when exactly 50 rows exist", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    for (let n = 0; n < 50; n += 1) await movement("A", w, p, { at: T(n) });
    const result = await listMovements(owner([w]), {});
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by product, type, creator", async () => {
    const w = await world.createWarehouse("A");
    const p1 = await world.createProduct("A");
    const p2 = await world.createProduct("A");
    const byOwner = await movement("A", w, p1, { at: T(1), createdById: world.users.A.OWNER.id });
    const adjusted = await movement("A", w, p2, { at: T(2), type: "ADJUST", createdById: null });
    const ctx = owner([w]);
    expect(ids(await listMovements(ctx, { productId: p1 }))).toEqual([byOwner]);
    expect(ids(await listMovements(ctx, { createdById: world.users.A.OWNER.id }))).toEqual([byOwner]);
    expect(ids(await listMovements(ctx, { type: "RECEIVE" }))).toEqual([byOwner]);
    expect(ids(await listMovements(ctx, { type: "ADJUST" }))).toEqual([adjusted]);
    expect((await listMovements(ctx, { productId: await world.createProduct("B") })).items).toEqual([]);
  });

  it("from is inclusive and to is exclusive", async () => {
    const w = await world.createWarehouse("A");
    const p = await world.createProduct("A");
    const ids3 = [await movement("A", w, p, { at: T(1) }), await movement("A", w, p, { at: T(2) }), await movement("A", w, p, { at: T(3) })];
    const ctx = owner([w]);
    expect(ids(await listMovements(ctx, { from: T(2) }))).toEqual([ids3[2], ids3[1]]);
    expect(ids(await listMovements(ctx, { to: T(3) }))).toEqual([ids3[1], ids3[0]]);
    expect(ids(await listMovements(ctx, { from: T(2), to: T(3) }))).toEqual([ids3[1]]);
  });

  it("returns only movements of the caller's warehouses; a warehouseId out of reach gives an empty list", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    const p = await world.createProduct("A");
    const visible = await movement("A", mine, p, { at: T(1) });
    await movement("A", other, p, { at: T(2) });
    const ctx = owner([mine]);

    expect(ids(await listMovements(ctx, {}))).toEqual([visible]);
    expect(ids(await listMovements(ctx, { warehouseId: mine }))).toEqual([visible]);
    for (const warehouseId of [other, foreign, "33333333-3333-4333-8333-333333333333"]) {
      expect(await listMovements(ctx, { warehouseId })).toEqual({ items: [], nextCursor: null });
    }
    expect(await listMovements(owner([]), {})).toEqual({ items: [], nextCursor: null });
  });

  it("never returns a movement of another organization, even for a warehouse id placed in ctx", async () => {
    const mine = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    const pb = await world.createProduct("B");
    await movement("B", foreign, pb, { at: T(1) });
    expect((await listMovements(owner([mine, foreign]), {})).items).toEqual([]);
  });
});
