const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

let organizationId;
let warehouseId;
let productId;
let transferId;
let createdById;

const insertReturningId = async (sql, replacements) => {
  const [rows] = await getSequelize().query(`${sql} RETURNING "id"`, {
    replacements,
  });
  return rows[0].id;
};

const insertMovement = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "StockMovements"
       ("organizationId", "warehouseId", "productId", "quantityDelta", "type", "reason", "transferId", "importJobId")
     VALUES (:organizationId, :warehouseId, :productId, :quantityDelta,
             CAST(:type AS "enum_StockMovements_type"),
             CAST(:reason AS "enum_StockMovements_reason"), :transferId, :importJobId)`,
    {
      replacements: {
        organizationId,
        warehouseId,
        productId,
        quantityDelta: 5,
        type: "RECEIVE",
        reason: null,
        transferId: null,
        importJobId: null,
        ...overrides,
      },
    },
  );

describe("StockMovements table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertReturningId(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', 'tokomaju')`,
    );
    warehouseId = await insertReturningId(
      `INSERT INTO "Warehouses" ("organizationId", "code", "name") VALUES (:organizationId, 'GD-01', 'A')`,
      { organizationId },
    );
    const other = await insertReturningId(
      `INSERT INTO "Warehouses" ("organizationId", "code", "name") VALUES (:organizationId, 'GD-02', 'B')`,
      { organizationId },
    );
    productId = await insertReturningId(
      `INSERT INTO "Products" ("organizationId", "sku", "name", "unit") VALUES (:organizationId, 'IDM', 'Indomie', 'bks')`,
      { organizationId },
    );
    createdById = await insertReturningId(
      `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role")
       VALUES (:organizationId, 'budi@example.com', 'Budi', 'hash', 'OWNER')`,
      { organizationId },
    );
    transferId = await insertReturningId(
      `INSERT INTO "StockTransfers" ("organizationId", "code", "fromWarehouseId", "toWarehouseId")
       VALUES (:organizationId, 'MT-0001', :warehouseId, :other)`,
      { organizationId, warehouseId, other },
    );
  });

  afterAll(() => clearTables(getSequelize()));

  it("stores a receipt with a generated id and createdAt, and no updatedAt", async () => {
    await insertMovement();
    const [rows] = await getSequelize().query('SELECT * FROM "StockMovements"');

    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0]).not.toHaveProperty("updatedAt");
    expect(rows[0].reason).toBeNull();
  });

  it.each(["STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"])(
    "accepts an ADJUST with the reason %s, in either direction",
    async (reason) => {
      await insertMovement({ type: "ADJUST", reason, quantityDelta: -3 });
      await insertMovement({ type: "ADJUST", reason, quantityDelta: 3 });
    },
  );

  it("refuses a type outside the enum", async () => {
    await expect(insertMovement({ type: "SELL" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses a reason outside the enum", async () => {
    await expect(
      insertMovement({ type: "ADJUST", reason: "THEFT" }),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  it("requires a reason for ADJUST and forbids it for other types", async () => {
    expect(await constraintOf(insertMovement({ type: "ADJUST" }))).toBe(
      "StockMovements_reason_check",
    );
    expect(await constraintOf(insertMovement({ reason: "LOST" }))).toBe(
      "StockMovements_reason_check",
    );
  });

  it("refuses a delta of 0 and the wrong sign for the type", async () => {
    const reason = "CORRECTION";
    expect(
      await constraintOf(
        insertMovement({ type: "ADJUST", reason, quantityDelta: 0 }),
      ),
    ).toBe("StockMovements_quantityDelta_check");
    expect(await constraintOf(insertMovement({ quantityDelta: -1 }))).toBe(
      "StockMovements_quantityDelta_check",
    );
    expect(
      await constraintOf(
        insertMovement({ type: "TRANSFER_OUT", transferId, quantityDelta: 1 }),
      ),
    ).toBe("StockMovements_quantityDelta_check");
  });

  it("links transfer movements to their transfer, and only those", async () => {
    await insertMovement({
      type: "TRANSFER_OUT",
      transferId,
      quantityDelta: -2,
    });
    await insertMovement({ type: "TRANSFER_IN", transferId, quantityDelta: 2 });
    expect(
      await constraintOf(
        insertMovement({ type: "TRANSFER_IN", quantityDelta: 2 }),
      ),
    ).toBe("StockMovements_transferId_check");
    expect(await constraintOf(insertMovement({ transferId }))).toBe(
      "StockMovements_transferId_check",
    );
  });

  it("requires an import job for IMPORT movements and forbids it otherwise", async () => {
    const importJobId = "00000000-0000-4000-8000-000000000000";
    expect(await constraintOf(insertMovement({ type: "IMPORT" }))).toBe(
      "StockMovements_importJobId_check",
    );
    expect(await constraintOf(insertMovement({ importJobId }))).toBe(
      "StockMovements_importJobId_check",
    );
  });

  it("accepts an IMPORT movement that points to an import job", async () => {
    const importJobId = await insertReturningId(
      `INSERT INTO "ImportJobs" ("organizationId", "fileName", "totalRows", "errorRows", "createdById")
       VALUES (:organizationId, 'stok.csv', 1, 0, :createdById)`,
      { organizationId, createdById },
    );
    await insertMovement({ type: "IMPORT", importJobId });
  });

  it("refuses an import job that does not exist", async () => {
    expect(
      await constraintOf(
        insertMovement({
          type: "IMPORT",
          importJobId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("StockMovements_importJobId_fkey");
  });

  it("refuses to delete an import job that has movements", async () => {
    const importJobId = await insertReturningId(
      `INSERT INTO "ImportJobs" ("organizationId", "fileName", "totalRows", "errorRows", "createdById")
       VALUES (:organizationId, 'stok.csv', 1, 0, :createdById)`,
      { organizationId, createdById },
    );
    await insertMovement({ type: "IMPORT", importJobId });
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "ImportJobs"')),
    ).toBe("StockMovements_importJobId_fkey");
  });

  it("refuses a transfer, warehouse or product that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await constraintOf(insertMovement({ warehouseId: missing }))).toBe(
      "StockMovements_warehouseId_fkey",
    );
    expect(await constraintOf(insertMovement({ productId: missing }))).toBe(
      "StockMovements_productId_fkey",
    );
    expect(
      await constraintOf(
        insertMovement({
          type: "TRANSFER_IN",
          quantityDelta: 1,
          transferId: missing,
        }),
      ),
    ).toBe("StockMovements_transferId_fkey");
  });

  it("has composite indexes that start with organizationId", async () => {
    const [rows] = await getSequelize().query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE tablename = 'StockMovements' AND indexname LIKE 'StockMovements_organizationId_%_idx'`,
    );

    expect(rows).toHaveLength(3);
    rows.forEach((row) => expect(row.indexdef).toMatch(/\("organizationId", /));
  });

  it("has the history index (organizationId, createdAt DESC, id)", async () => {
    const [rows] = await getSequelize().query(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'StockMovements' AND indexname = 'StockMovements_organizationId_createdAt_id_idx'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('("organizationId", "createdAt" DESC, id)');
  });

  describe("append-only trigger", () => {
    beforeEach(() => insertMovement());

    it("refuses an UPDATE of any column", async () => {
      await expect(
        getSequelize().query('UPDATE "StockMovements" SET "note" = \'edited\''),
      ).rejects.toThrow(/StockMovements rows are append-only: UPDATE/);
    });

    it("refuses an UPDATE that tries to change the quantity", async () => {
      await expect(
        getSequelize().query(
          'UPDATE "StockMovements" SET "quantityDelta" = 99',
        ),
      ).rejects.toThrow(/append-only/);
    });

    it("refuses a DELETE", async () => {
      await expect(
        getSequelize().query('DELETE FROM "StockMovements"'),
      ).rejects.toThrow(/StockMovements rows are append-only: DELETE/);
    });

    it("reports the restrict_violation error code", async () => {
      const error = await getSequelize()
        .query('DELETE FROM "StockMovements"')
        .catch((e) => e);

      expect(error.parent.code).toBe("23001");
    });

    it("leaves the row unchanged after a refused UPDATE", async () => {
      await getSequelize()
        .query('UPDATE "StockMovements" SET "quantityDelta" = 99')
        .catch(() => {});
      const [rows] = await getSequelize().query(
        'SELECT "quantityDelta" FROM "StockMovements"',
      );

      expect(rows).toEqual([{ quantityDelta: 5 }]);
    });

    it("still accepts new rows", async () => {
      await insertMovement({ quantityDelta: 7 });
      const [rows] = await getSequelize().query(
        'SELECT count(*)::int AS n FROM "StockMovements"',
      );

      expect(rows[0].n).toBe(2);
    });
  });
});
