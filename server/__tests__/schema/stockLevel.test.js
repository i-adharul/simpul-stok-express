const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

let organizationId;
let warehouseId;
let productId;

const insertReturningId = async (sql, replacements) => {
  const [rows] = await getSequelize().query(`${sql} RETURNING "id"`, {
    replacements,
  });
  return rows[0].id;
};

const insertLevel = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "StockLevels" ("organizationId", "warehouseId", "productId", "quantity")
     VALUES (:organizationId, :warehouseId, :productId, :quantity)`,
    {
      replacements: {
        organizationId,
        warehouseId,
        productId,
        quantity: 10,
        ...overrides,
      },
    },
  );

describe("StockLevels table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertReturningId(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', 'tokomaju')`,
    );
    warehouseId = await insertReturningId(
      `INSERT INTO "Warehouses" ("organizationId", "code", "name")
       VALUES (:organizationId, 'GD-01', 'Gudang Utama')`,
      { organizationId },
    );
    productId = await insertReturningId(
      `INSERT INTO "Products" ("organizationId", "sku", "name", "unit")
       VALUES (:organizationId, 'IDM-001', 'Indomie', 'bks')`,
      { organizationId },
    );
  });

  afterAll(() => clearTables(getSequelize()));

  it("starts at quantity 0 by default", async () => {
    await getSequelize().query(
      `INSERT INTO "StockLevels" ("organizationId", "warehouseId", "productId")
       VALUES (:organizationId, :warehouseId, :productId)`,
      { replacements: { organizationId, warehouseId, productId } },
    );
    const [rows] = await getSequelize().query('SELECT * FROM "StockLevels"');

    expect(rows[0].quantity).toBe(0);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a negative quantity on insert", async () => {
    expect(await constraintOf(insertLevel({ quantity: -1 }))).toBe(
      "StockLevels_quantity_check",
    );
  });

  it("refuses an UPDATE that would make the quantity negative", async () => {
    await insertLevel({ quantity: 5 });
    expect(
      await constraintOf(
        getSequelize().query('UPDATE "StockLevels" SET "quantity" = -1'),
      ),
    ).toBe("StockLevels_quantity_check");
  });

  it("allows a decrement down to zero but refuses one below zero", async () => {
    await insertLevel({ quantity: 5 });
    await getSequelize().query(
      'UPDATE "StockLevels" SET "quantity" = "quantity" - 5',
    );
    expect(
      await constraintOf(
        getSequelize().query(
          'UPDATE "StockLevels" SET "quantity" = "quantity" - 1',
        ),
      ),
    ).toBe("StockLevels_quantity_check");
  });

  it("allows only one row per warehouse and product", async () => {
    await insertLevel();
    expect(await constraintOf(insertLevel())).toBe(
      "StockLevels_warehouseId_productId_key",
    );
  });

  it("refuses a warehouse or product that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await constraintOf(insertLevel({ warehouseId: missing }))).toBe(
      "StockLevels_warehouseId_fkey",
    );
    expect(await constraintOf(insertLevel({ productId: missing }))).toBe(
      "StockLevels_productId_fkey",
    );
  });

  it("refuses to delete a product that has a stock row", async () => {
    await insertLevel();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Products"')),
    ).toBe("StockLevels_productId_fkey");
  });

  it("has composite indexes that start with organizationId", async () => {
    const [rows] = await getSequelize().query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'StockLevels' AND indexname LIKE '%_idx'`,
    );

    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.indexdef).toMatch(/\("organizationId", /));
  });
});
