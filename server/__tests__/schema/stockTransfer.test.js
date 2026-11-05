const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

let organizationId;
let warehouseA;
let warehouseB;

const insertReturningId = async (sql, replacements) => {
  const [rows] = await getSequelize().query(`${sql} RETURNING "id"`, {
    replacements,
  });
  return rows[0].id;
};

const insertWarehouse = (orgId, code) =>
  insertReturningId(
    `INSERT INTO "Warehouses" ("organizationId", "code", "name") VALUES (:orgId, :code, 'Gudang')`,
    { orgId, code },
  );

const insertTransfer = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "StockTransfers" ("organizationId", "code", "fromWarehouseId", "toWarehouseId")
     VALUES (:organizationId, :code, :fromWarehouseId, :toWarehouseId)`,
    {
      replacements: {
        organizationId,
        code: "MT-0001",
        fromWarehouseId: warehouseA,
        toWarehouseId: warehouseB,
        ...overrides,
      },
    },
  );

describe("StockTransfers table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertReturningId(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', 'tokomaju')`,
    );
    warehouseA = await insertWarehouse(organizationId, "GD-01");
    warehouseB = await insertWarehouse(organizationId, "GD-02");
  });

  afterAll(() => clearTables(getSequelize()));

  it("stores a transfer with no status column and an empty creator", async () => {
    await insertTransfer();
    const [rows] = await getSequelize().query('SELECT * FROM "StockTransfers"');

    expect(rows[0].createdById).toBeNull();
    expect(rows[0].note).toBeNull();
    expect(rows[0]).not.toHaveProperty("status");
  });

  it("refuses the same code twice in one organization", async () => {
    await insertTransfer();
    expect(await constraintOf(insertTransfer())).toBe(
      "StockTransfers_organizationId_code_key",
    );
  });

  it("allows the same code in another organization", async () => {
    await insertTransfer();
    const other = await insertReturningId(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Lain', 'lain')`,
    );
    await insertTransfer({
      organizationId: other,
      fromWarehouseId: await insertWarehouse(other, "GD-01"),
      toWarehouseId: await insertWarehouse(other, "GD-02"),
    });
  });

  it("refuses a transfer whose source equals its destination", async () => {
    expect(
      await constraintOf(insertTransfer({ toWarehouseId: warehouseA })),
    ).toBe("StockTransfers_warehouses_check");
  });

  it("refuses a warehouse that does not exist", async () => {
    expect(
      await constraintOf(
        insertTransfer({
          toWarehouseId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("StockTransfers_toWarehouseId_fkey");
  });

  it("refuses to delete a warehouse used by a transfer", async () => {
    await insertTransfer();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Warehouses"')),
    ).toBeDefined();
  });
});
