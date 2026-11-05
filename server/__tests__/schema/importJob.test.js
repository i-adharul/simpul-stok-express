const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");
const { createOrganization, createUser } = require("../support/factories");

let organizationId;
let createdById;

const insertJob = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "ImportJobs" ("organizationId", "fileName", "status", "totalRows", "errorRows", "createdById")
     VALUES (:organizationId, 'stok.csv', CAST(:status AS "enum_ImportJobs_status"), :totalRows, :errorRows, :createdById)`,
    {
      replacements: {
        organizationId,
        createdById,
        status: "PREVIEW",
        totalRows: 10,
        errorRows: 0,
        ...overrides,
      },
    },
  );

describe("ImportJobs table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await createOrganization();
    createdById = await createUser(organizationId);
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults: empty rows, no error report", async () => {
    await getSequelize().query(
      `INSERT INTO "ImportJobs" ("organizationId", "fileName", "totalRows", "errorRows", "createdById")
       VALUES (:organizationId, 'stok.csv', 3, 0, :createdById)`,
      { replacements: { organizationId, createdById } },
    );
    const [rows] = await getSequelize().query('SELECT * FROM "ImportJobs"');

    expect(rows[0].status).toBe("PREVIEW");
    expect(rows[0].rows).toEqual([]);
    expect(rows[0].errorReport).toBeNull();
  });

  it("stores the valid rows and the error report as JSON", async () => {
    await getSequelize().query(
      `INSERT INTO "ImportJobs" ("organizationId", "fileName", "totalRows", "errorRows", "createdById", "rows", "errorReport")
       VALUES (:organizationId, 'stok.csv', 2, 1, :createdById, CAST(:rows AS jsonb), CAST(:report AS jsonb))`,
      {
        replacements: {
          organizationId,
          createdById,
          rows: JSON.stringify([
            { sku: "A", warehouseCode: "GD-01", quantity: 5 },
          ]),
          report: JSON.stringify([{ row: 2, message: "SKU not found" }]),
        },
      },
    );
    const [rows] = await getSequelize().query('SELECT * FROM "ImportJobs"');

    expect(rows[0].rows[0].quantity).toBe(5);
    expect(rows[0].errorReport[0].row).toBe(2);
  });

  it.each(["PREVIEW", "COMMITTED", "FAILED"])(
    "accepts the status %s",
    async (status) => {
      await insertJob({ status });
    },
  );

  it("refuses a status outside the enum", async () => {
    await expect(insertJob({ status: "DONE" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses more than 5,000 rows", async () => {
    expect(await constraintOf(insertJob({ totalRows: 5001 }))).toBe(
      "ImportJobs_totalRows_check",
    );
    await insertJob({ totalRows: 5000 });
  });

  it("refuses more error rows than rows", async () => {
    expect(await constraintOf(insertJob({ totalRows: 2, errorRows: 3 }))).toBe(
      "ImportJobs_errorRows_check",
    );
  });

  it("refuses to commit a job that has errors", async () => {
    expect(
      await constraintOf(insertJob({ status: "COMMITTED", errorRows: 1 })),
    ).toBe("ImportJobs_committed_check");
    await insertJob({ status: "FAILED", errorRows: 1 });
  });

  it("refuses a creator that does not exist", async () => {
    expect(
      await constraintOf(
        insertJob({ createdById: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("ImportJobs_createdById_fkey");
  });
});
