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
const show = (id, role = "OWNER") => request(app).get(`/api/stock/movements/${id}`).set("Authorization", as(role));
const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";

async function movement({ warehouseId, productId, organization = "A", type = "RECEIVE", createdById = null, transferId = null }) {
  const id = crypto.randomUUID();
  await sql(
    `INSERT INTO "StockMovements" (id, "organizationId", "warehouseId", "productId", "quantityDelta", type, reason, "transferId", "createdById")
     VALUES (:id, :organizationId, :warehouseId, :productId, :delta, CAST(:type AS "enum_StockMovements_type"),
             CAST(:reason AS "enum_StockMovements_reason"), :transferId, :createdById)`,
    {
      id, organizationId: world.organizations[organization], warehouseId, productId, type, createdById, transferId,
      delta: type === "TRANSFER_OUT" ? -3 : 3, reason: type === "ADJUST" ? "LOST" : null,
    },
  );
  return id;
}

describe("GET /api/stock/movements/:id", () => {
  it("returns the list item plus warehouse, product, createdBy and a null transfer", async () => {
    const warehouseId = await world.createWarehouse("A", "GD-1");
    const productId = await world.createProduct("A", "SKU-1");
    const id = await movement({ warehouseId, productId, createdById: world.users.A.OWNER.id });

    const res = await show(id);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      id, warehouseId, productId, type: "RECEIVE", quantityDelta: 3, reason: null, note: null, transferId: null,
      createdById: world.users.A.OWNER.id, createdAt: expect.any(String),
      warehouse: { id: warehouseId, code: "GD-1", name: "GD-1" },
      product: { id: productId, sku: "SKU-1", name: "SKU-1", unit: "pcs" },
      createdBy: { id: world.users.A.OWNER.id, name: "OWNER A", role: "OWNER" },
      transfer: null,
    });
  });

  it("never contains an email", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    const id = await movement({ warehouseId, productId, createdById: world.users.A.OWNER.id });
    const res = await show(id);
    expect(res.text).not.toContain("@");
    expect(Object.keys(res.body.createdBy).sort()).toEqual(["id", "name", "role"]);
  });

  it("has createdBy null when the movement has no creator", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    expect((await show(await movement({ warehouseId, productId }))).body.createdBy).toBeNull();
  });

  it("shows the reason of an ADJUST movement", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    const res = await show(await movement({ warehouseId, productId, type: "ADJUST" }));
    expect(res.body).toMatchObject({ type: "ADJUST", reason: "LOST" });
  });

  it("describes the transfer behind a TRANSFER_OUT movement, with both warehouse names", async () => {
    const from = await world.createWarehouse("A", "GD-A");
    const to = await world.createWarehouse("A", "GD-B");
    const productId = await world.createProduct("A");
    const [{ id: transferId }] = await sql(
      `INSERT INTO "StockTransfers" ("organizationId", code, "fromWarehouseId", "toWarehouseId") VALUES (:o, 'TRF-1', :from, :to) RETURNING id`,
      { o: orgA(), from, to },
    );
    const id = await movement({ warehouseId: from, productId, type: "TRANSFER_OUT", transferId });

    const res = await show(id);

    expect(res.status).toBe(200);
    expect(res.body.transfer).toEqual({ id: transferId, code: "TRF-1", fromWarehouse: { id: from, name: "GD-A" }, toWarehouse: { id: to, name: "GD-B" } });
  });

  it("answers the same 404 for a malformed, a missing and a foreign id", async () => {
    const wb = await world.createWarehouse("B");
    const pb = await world.createProduct("B");
    const foreign = await movement({ warehouseId: wb, productId: pb, organization: "B" });

    const responses = [await show("not-a-uuid"), await show(RANDOM_UUID), await show(foreign)];

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("NOT_FOUND");
    }
    expect(new Set(responses.map((r) => r.text)).size).toBe(1);
  });

  it("answers that same 404 for a movement in a warehouse the caller does not reach", async () => {
    const mine = await world.createWarehouse("A");
    const other = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    await assignWarehouse(orgA(), world.users.A.VIEWER.id, mine);
    const hidden = await movement({ warehouseId: other, productId });
    const visible = await movement({ warehouseId: mine, productId });
    const missing = await show(RANDOM_UUID, "VIEWER");

    const res = await show(hidden, "VIEWER");

    expect(res.status).toBe(404);
    expect(res.text).toBe(missing.text);
    expect((await show(visible, "VIEWER")).status).toBe(200);
    expect((await show(hidden, "OWNER")).status).toBe(200);
  });

  it("answers that 404 for a movement of an archived warehouse, even to the Owner", async () => {
    const warehouseId = await world.createWarehouse("A");
    const productId = await world.createProduct("A");
    const id = await movement({ warehouseId, productId });
    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: warehouseId });
    expect((await show(id)).status).toBe(404);
  });

  it("answers 401 without a token and 403 to a platform admin, before looking at the id", async () => {
    expect((await request(app).get(`/api/stock/movements/${RANDOM_UUID}`)).status).toBe(401);
    expect((await request(app).get(`/api/stock/movements/${RANDOM_UUID}`).set("Authorization", world.platformAdmin.authorization)).status).toBe(403);
  });
});
