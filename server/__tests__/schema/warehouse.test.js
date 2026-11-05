const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

let organizationId;

const insertOrganization = async (slug) => {
  const [rows] = await getSequelize().query(
    `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', :slug) RETURNING "id"`,
    { replacements: { slug } },
  );
  return rows[0].id;
};

const insertWarehouse = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Warehouses" ("organizationId", "code", "name", "address")
     VALUES (:organizationId, :code, :name, :address)`,
    {
      replacements: {
        organizationId,
        code: "GD-01",
        name: "Gudang Utama",
        address: null,
        ...overrides,
      },
    },
  );

describe("Warehouses table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertOrganization("tokomaju");
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults in the database", async () => {
    await insertWarehouse();
    const [rows] = await getSequelize().query('SELECT * FROM "Warehouses"');

    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].archivedAt).toBeNull();
    expect(rows[0].address).toBeNull();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("refuses a second warehouse with the same code in one organization", async () => {
    await insertWarehouse();
    expect(await constraintOf(insertWarehouse({ name: "Lain" }))).toBe(
      "Warehouses_organizationId_code_key",
    );
  });

  it("allows the same code in another organization", async () => {
    await insertWarehouse();
    const other = await insertOrganization("tokolain");
    await insertWarehouse({ organizationId: other });
  });

  it.each(["gd-01", " GD-01", ""])("refuses the code %j", async (code) => {
    expect(await constraintOf(insertWarehouse({ code }))).toBe(
      "Warehouses_code_check",
    );
  });

  it("refuses a code longer than 20 characters", async () => {
    await expect(insertWarehouse({ code: "A".repeat(21) })).rejects.toThrow(
      /value too long/,
    );
  });

  it("refuses a blank name", async () => {
    expect(await constraintOf(insertWarehouse({ name: "  " }))).toBe(
      "Warehouses_name_check",
    );
  });

  it("refuses an organization that does not exist", async () => {
    expect(
      await constraintOf(
        insertWarehouse({
          organizationId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("Warehouses_organizationId_fkey");
  });

  it("refuses to delete an organization that has a warehouse", async () => {
    await insertWarehouse();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Organizations"')),
    ).toBe("Warehouses_organizationId_fkey");
  });
});
