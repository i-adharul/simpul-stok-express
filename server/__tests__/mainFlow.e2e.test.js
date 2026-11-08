const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const plans = require("../seeders/20261105000100-plans");
const baseAccounts = require("../seeders/20261105000200-base-accounts");
const demoStock = require("../seeders/20261108000300-demo-stock");

// The main flow of the product from the outside (docs/06): log in with the demo account, receive
// stock, transfer it, then read the stock, the history and the dashboard. Everything goes through
// HTTP and the demo seed, no factories and no direct writes, so it also proves the seed is usable.
// The steps run in order and share what the earlier ones learned: if one fails, read the first
// failure, the later ones fail because of it.

jest.setTimeout(120000);

const PASSWORD = "Simpul-Demo-2026";
const qi = () => getSequelize().getQueryInterface();
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];

let owner;
let warehouses;
let source; // GD-JKT
let destination; // GD-SBY
let product; // a product that the source stocks well
let before; // the numbers read before the flow writes anything
const receiveKey = crypto.randomUUID();
const transferKey = crypto.randomUUID();
const flow = {};

const as = (session) => ({ Authorization: `Bearer ${session.token}` });
const get = (session, path, query = {}) => request(app).get(path).query(query).set(as(session));
const login = async (email, password = PASSWORD) => {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { res, token: res.body.token };
};
const quantityAt = async (warehouseId, productId) => {
  const res = await get(owner, "/api/stock", { warehouseId, productId });
  expect(res.status).toBe(200);
  return res.body.items[0]?.quantity ?? 0;
};
const receive = (session, body, key = crypto.randomUUID()) =>
  request(app).post("/api/stock/receive").set(as(session)).set("Idempotency-Key", key).send(body);
const transfer = (session, body, key = crypto.randomUUID()) =>
  request(app).post("/api/stock/transfers").set(as(session)).set("Idempotency-Key", key).send(body);

beforeAll(async () => {
  await clearTables(getSequelize());
  await plans.up(qi());
  await baseAccounts.up(qi());
  await demoStock.seedDemo(qi(), new Date());
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("main flow, end to end", () => {
  it("1. rejects a wrong password and logs the Owner in with the demo password", async () => {
    const wrong = await login("owner@example.com", "not-the-password");
    expect(wrong.res.status).toBe(401);

    const ok = await login("owner@example.com");
    expect(ok.res.status).toBe(200);
    expect(ok.res.body.user).toMatchObject({ email: "owner@example.com", role: "OWNER" });
    expect(ok.res.body.redirectTo).toBe("/dashboard");
    owner = ok;
  });

  it("2. sees the demo organization: 3 warehouses and 50 products", async () => {
    const warehouseList = await get(owner, "/api/warehouses", { pageSize: 100 });
    const productList = await get(owner, "/api/products", { pageSize: 100 });

    expect(warehouseList.status).toBe(200);
    expect(productList.status).toBe(200);
    warehouses = Object.fromEntries(warehouseList.body.items.map((w) => [w.code, w]));
    expect(Object.keys(warehouses).sort()).toEqual(["GD-BDG", "GD-JKT", "GD-SBY"]);
    expect(productList.body.items).toHaveLength(50);
    source = warehouses["GD-JKT"].id;
    destination = warehouses["GD-SBY"].id;
  });

  it("3. reads the numbers before the flow: a stocked product, both quantities, the dashboard", async () => {
    const stocked = await get(owner, "/api/stock", { warehouseId: source, status: "OK" });
    expect(stocked.body.items.length).toBeGreaterThan(0);
    product = stocked.body.items[0].product;

    const dashboard = await get(owner, "/api/dashboard");
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.restock.total).toBeGreaterThan(0);
    before = {
      source: await quantityAt(source, product.id),
      destination: await quantityAt(destination, product.id),
      units: dashboard.body.summary.totalUnits,
      today: dashboard.body.summary.movementsToday,
      movements: Number((await sql(`SELECT count(*) AS n FROM "StockMovements"`))[0].n),
    };
    expect(before.source).toBeGreaterThan(0);
  });

  it("4. receives 25 units at the source; the same Idempotency-Key again changes nothing", async () => {
    const body = { warehouseId: source, productId: product.id, quantity: 25, note: "PO-E2E-001" };

    const first = await receive(owner, body, receiveKey);
    const again = await receive(owner, body, receiveKey);

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ warehouseId: source, productId: product.id, quantity: 25 });
    expect(again.status).toBe(201);
    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(again.body).toEqual(first.body);
    flow.receiveId = first.body.id;
    expect(await quantityAt(source, product.id)).toBe(before.source + 25);
  });

  it("5. transfers 10 units from the source to the destination as the next transfer code", async () => {
    const body = { fromWarehouseId: source, toWarehouseId: destination, items: [{ productId: product.id, quantity: 10 }], note: "E2E" };
    const seededTransfers = Number((await sql(`SELECT count(*) AS n FROM "StockTransfers"`))[0].n);

    const res = await transfer(owner, body, transferKey);
    const replay = await transfer(owner, body, transferKey);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(`MT-${String(seededTransfers + 1).padStart(4, "0")}`);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(res.body);
    flow.transferId = res.body.id;
    flow.transferCode = res.body.code;
  });

  it("6. shows the new stock: the source lost 10 of the 25, the destination gained 10, the total grew by 25", async () => {
    expect(await quantityAt(source, product.id)).toBe(before.source + 25 - 10);
    expect(await quantityAt(destination, product.id)).toBe(before.destination + 10);

    const dashboard = await get(owner, "/api/dashboard");
    expect(dashboard.body.summary.totalUnits).toBe(before.units + 25);
  });

  it("7. records the history: three movements, newest first, two of them sharing the transfer", async () => {
    const res = await get(owner, "/api/stock/movements", { productId: product.id });

    expect(res.status).toBe(200);
    const mine = res.body.items.filter((m) => [flow.receiveId].includes(m.id) || m.transferId === flow.transferId);
    expect(mine).toHaveLength(3);
    expect(mine.map((m) => m.type).sort()).toEqual(["RECEIVE", "TRANSFER_IN", "TRANSFER_OUT"]);
    expect(mine.find((m) => m.type === "TRANSFER_OUT").quantityDelta).toBe(-10);
    expect(mine.find((m) => m.type === "TRANSFER_IN").quantityDelta).toBe(10);
    const times = res.body.items.map((m) => new Date(m.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    flow.outId = mine.find((m) => m.type === "TRANSFER_OUT").id;

    expect(Number((await sql(`SELECT count(*) AS n FROM "StockMovements"`))[0].n)).toBe(before.movements + 3);
  });

  it("8. opens one movement and the transfer behind it", async () => {
    const movement = await get(owner, `/api/stock/movements/${flow.outId}`);
    const detail = await get(owner, `/api/stock/transfers/${flow.transferId}`);

    expect(movement.status).toBe(200);
    expect(movement.body.transfer).toMatchObject({ id: flow.transferId, code: flow.transferCode });
    expect(movement.body.createdBy.name).toBe("Budi Owner");
    expect(detail.status).toBe(200);
    expect(detail.body.code).toBe(flow.transferCode);
  });

  it("9. shows the activity on the dashboard: three more movements today, the three newest on top", async () => {
    const res = await get(owner, "/api/dashboard");

    expect(res.body.summary.movementsToday).toBe(before.today + 3);
    expect(res.body.recentActivity.slice(0, 3).map((m) => m.type).sort()).toEqual(["RECEIVE", "TRANSFER_IN", "TRANSFER_OUT"]);
    expect(res.body.recentActivity.map((m) => m.id)).toContain(flow.receiveId);
  });

  it("10. refuses to move more than the source holds: 409 INSUFFICIENT_STOCK and nothing changes", async () => {
    const held = await quantityAt(source, product.id);
    const movements = Number((await sql(`SELECT count(*) AS n FROM "StockMovements"`))[0].n);

    const res = await transfer(owner, { fromWarehouseId: source, toWarehouseId: destination, items: [{ productId: product.id, quantity: held + 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INSUFFICIENT_STOCK");
    expect(await quantityAt(source, product.id)).toBe(held);
    expect(Number((await sql(`SELECT count(*) AS n FROM "StockMovements"`))[0].n)).toBe(movements);
  });

  it("11. applies the roles: the Warehouse Admin works in an assigned warehouse only, the Viewer reads but cannot write", async () => {
    const admin = await login("admin@example.com");
    const viewer = await login("viewer@example.com");
    const body = (warehouseId) => ({ warehouseId, productId: product.id, quantity: 1 });

    expect((await receive(admin, body(source))).status).toBe(201);
    expect((await receive(admin, body(destination))).status).toBe(403); // GD-SBY is not assigned to the admin
    expect((await receive(viewer, body(source))).status).toBe(403);
    expect((await get(viewer, "/api/dashboard")).status).toBe(200);
    // The Viewer is assigned to GD-JKT only, so the dashboard counts that warehouse alone.
    const owned = (await get(owner, "/api/dashboard")).body.summary.totalUnits;
    const seen = (await get(viewer, "/api/dashboard")).body.summary.totalUnits;
    expect(seen).toBeLessThan(owned);
  });

  it("12. leaves the books consistent: every stock level equals the sum of its movements", async () => {
    const wrong = await sql(
      `SELECT l."warehouseId", l."productId" FROM "StockLevels" l
       LEFT JOIN "StockMovements" m ON m."warehouseId" = l."warehouseId" AND m."productId" = l."productId"
       GROUP BY l."warehouseId", l."productId", l.quantity
       HAVING l.quantity <> COALESCE(SUM(m."quantityDelta"), 0)`,
    );
    expect(wrong).toEqual([]);
    expect(await sql(`SELECT 1 FROM "StockLevels" WHERE quantity < 0`)).toEqual([]);
  });
});
