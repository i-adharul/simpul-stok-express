const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");
const { getSummary } = require("../services/dashboardService");
const { wibDayRange } = require("../helpers/wibDay");

jest.setTimeout(60000);

let world;
let ctxOf;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  ctxOf = (role, warehouseIds) => ({ userId: world.users.A[role].id, organizationId: world.organizations.A, role, warehouseIds });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const A = () => world.organizations.A;
const productWith = async ({ minStock = 0, archived = false, organization = "A" } = {}) => {
  const id = await world.createProduct(organization);
  await sql(`UPDATE "Products" SET "minStock" = :minStock, "archivedAt" = :archivedAt WHERE id = :id`, {
    id,
    minStock,
    archivedAt: archived ? new Date() : null,
  });
  return id;
};
const level = (warehouseId, productId, quantity, organization = "A") =>
  createStockLevel(world.organizations[organization], warehouseId, productId, quantity);
const movement = (warehouseId, productId, at, organization = "A") =>
  sql(
    `INSERT INTO "StockMovements" ("organizationId", "warehouseId", "productId", "quantityDelta", type, "createdAt")
     VALUES (:organizationId, :warehouseId, :productId, 5, 'RECEIVE', :at)`,
    { organizationId: world.organizations[organization], warehouseId, productId, at },
  );

describe("wibDayRange", () => {
  it("is the WIB calendar day of the instant: 00:00 WIB (17:00 UTC the day before) to the next 00:00", () => {
    const { from, to } = wibDayRange(new Date("2026-11-08T03:00:00Z")); // 10:00 WIB on 8 Nov
    expect(from.toISOString()).toBe("2026-11-07T17:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-08T17:00:00.000Z");
  });

  it("moves to the next WIB day at 17:00 UTC, while the UTC date is still the old one", () => {
    expect(wibDayRange(new Date("2026-11-08T16:59:59.999Z")).from.toISOString()).toBe("2026-11-07T17:00:00.000Z");
    expect(wibDayRange(new Date("2026-11-08T17:00:00Z")).from.toISOString()).toBe("2026-11-08T17:00:00.000Z");
  });
});

describe("summary.totalProducts", () => {
  it("counts the active products of the whole organization, whatever warehouses the caller reaches", async () => {
    const mine = await world.createWarehouse("A");
    await productWith();
    await productWith();
    await productWith({ archived: true });
    await productWith({ organization: "B" });

    const { totalProducts } = await getSummary(ctxOf("VIEWER", [mine]));

    expect(totalProducts).toBe(2);
  });

  it("is 0 for an organization without products", async () => {
    expect((await getSummary(ctxOf("OWNER", []))).totalProducts).toBe(0);
  });
});

describe("summary.totalUnits", () => {
  it("adds the units of the caller's warehouses, archived products included, and nothing else", async () => {
    const w1 = await world.createWarehouse("A");
    const w2 = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const active = await productWith();
    const archived = await productWith({ archived: true });
    await level(w1, active, 10);
    await level(w2, active, 5);
    await level(w1, archived, 7);
    await level(other, active, 1000); // a warehouse the caller does not reach
    const foreignWarehouse = await world.createWarehouse("B");
    await level(foreignWarehouse, await productWith({ organization: "B" }), 500, "B");

    expect((await getSummary(ctxOf("WAREHOUSE_ADMIN", [w1, w2]))).totalUnits).toBe(22);
    expect((await getSummary(ctxOf("OWNER", [w1, w2, other]))).totalUnits).toBe(1022);
  });

  it("is the number 0, not null or a string, when nothing is stocked or the caller has no warehouse", async () => {
    const w = await world.createWarehouse("A");
    expect((await getSummary(ctxOf("OWNER", [w]))).totalUnits).toBe(0);
    expect((await getSummary(ctxOf("VIEWER", []))).totalUnits).toBe(0);
  });
});

describe("summary.lowCount and outCount", () => {
  it("count pairs below minStock and at zero, and leave archived products out", async () => {
    const w = await world.createWarehouse("A");
    const out = await productWith({ minStock: 5 });
    const low = await productWith({ minStock: 5 });
    const edge = await productWith({ minStock: 5 });
    const ok = await productWith({ minStock: 5 });
    const archivedOut = await productWith({ minStock: 5, archived: true });
    const archivedLow = await productWith({ minStock: 5, archived: true });
    await level(w, out, 0);
    await level(w, low, 4);
    await level(w, edge, 5);
    await level(w, ok, 9);
    await level(w, archivedOut, 0);
    await level(w, archivedLow, 1);

    const summary = await getSummary(ctxOf("OWNER", [w]));

    expect(summary.outCount).toBe(1);
    expect(summary.lowCount).toBe(1);
  });

  it("count pairs of the caller's warehouses only, and minStock 0 or 1 is never LOW", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const p = await productWith({ minStock: 5 });
    const zero = await productWith({ minStock: 0 });
    const one = await productWith({ minStock: 1 });
    await level(mine, p, 2);
    await level(other, p, 0);
    await level(mine, zero, 1);
    await level(mine, one, 1);

    const summary = await getSummary(ctxOf("VIEWER", [mine]));

    expect(summary.lowCount).toBe(1);
    expect(summary.outCount).toBe(0);
  });

  it("never count a pair of another organization", async () => {
    const mine = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");
    await level(foreign, await productWith({ minStock: 5, organization: "B" }), 0, "B");

    const summary = await getSummary(ctxOf("OWNER", [mine, foreign]));

    expect(summary.outCount).toBe(0);
    expect(summary.lowCount).toBe(0);
  });
});

describe("summary.movementsToday", () => {
  const NOW = new Date("2026-11-08T03:00:00Z"); // 10:00 WIB on 8 Nov: the day is 07 Nov 17:00Z to 08 Nov 17:00Z

  it("counts the WIB calendar day: first instant in, last instant in, the instants around it out", async () => {
    const w = await world.createWarehouse("A");
    const p = await productWith();
    await movement(w, p, new Date("2026-11-07T16:59:59.999Z")); // 23:59:59 WIB the day before: out
    await movement(w, p, new Date("2026-11-07T17:00:00Z")); // 00:00:00 WIB: in
    await movement(w, p, new Date("2026-11-08T16:59:59.999Z")); // 23:59:59 WIB: in
    await movement(w, p, new Date("2026-11-08T17:00:00Z")); // 00:00 WIB the next day: out

    expect((await getSummary(ctxOf("OWNER", [w]), NOW)).movementsToday).toBe(2);
  });

  it("counts both movements of a transfer, only in the caller's warehouses and own organization", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const p = await productWith();
    const at = new Date("2026-11-08T01:00:00Z");
    await movement(mine, p, at);
    await movement(mine, p, at);
    await movement(other, p, at);
    const foreign = await world.createWarehouse("B");
    await movement(foreign, await productWith({ organization: "B" }), at, "B");

    expect((await getSummary(ctxOf("VIEWER", [mine]), NOW)).movementsToday).toBe(2);
    expect((await getSummary(ctxOf("OWNER", [mine, other]), NOW)).movementsToday).toBe(3);
  });

  it("uses the real clock when no instant is given", async () => {
    const w = await world.createWarehouse("A");
    const p = await productWith();
    await movement(w, p, new Date());

    expect((await getSummary(ctxOf("OWNER", [w]))).movementsToday).toBe(1);
  });
});

describe("summary shape", () => {
  it("has exactly the five documented numbers", async () => {
    const summary = await getSummary(ctxOf("OWNER", []));
    expect(Object.keys(summary).sort()).toEqual(["lowCount", "movementsToday", "outCount", "totalProducts", "totalUnits"]);
    expect(Object.values(summary).every(Number.isInteger)).toBe(true);
  });
});
