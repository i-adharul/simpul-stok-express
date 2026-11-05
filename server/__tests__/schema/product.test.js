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

const insertProduct = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Products" ("organizationId", "sku", "name", "unit")
     VALUES (:organizationId, :sku, 'Indomie Goreng', CAST(:unit AS "enum_Products_unit"))`,
    {
      replacements: {
        organizationId,
        sku: "IDM-001",
        unit: "bks",
        ...overrides,
      },
    },
  );

describe("Products table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertOrganization("tokomaju");
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults in the database", async () => {
    await insertProduct();
    const [rows] = await getSequelize().query('SELECT * FROM "Products"');

    expect(rows[0].minStock).toBe(0);
    expect(rows[0].archivedAt).toBeNull();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["bks", "ktk", "pcs", "btl", "jrg", "pak"])(
    "accepts the unit %s",
    async (unit) => {
      await insertProduct({ unit });
    },
  );

  it("refuses a unit outside the enum", async () => {
    await expect(insertProduct({ unit: "kg" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses a second product with the same SKU in one organization", async () => {
    await insertProduct();
    expect(await constraintOf(insertProduct())).toBe(
      "Products_organizationId_sku_key",
    );
  });

  it("allows the same SKU in another organization", async () => {
    await insertProduct();
    await insertProduct({ organizationId: await insertOrganization("lain") });
  });

  it.each(["idm-001", "IDM 001", " IDM-001", ""])(
    "refuses the SKU %j",
    async (sku) => {
      expect(await constraintOf(insertProduct({ sku }))).toBe(
        "Products_sku_check",
      );
    },
  );

  it.each([-1, 1000000001])("refuses minStock %i", async (minStock) => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Products" ("organizationId", "sku", "name", "unit", "minStock")
           VALUES (:organizationId, 'A', 'x', 'pcs', :minStock)`,
          { replacements: { organizationId, minStock } },
        ),
      ),
    ).toBe("Products_minStock_check");
  });

  it("refuses a blank name", async () => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Products" ("organizationId", "sku", "name", "unit")
           VALUES (:organizationId, 'A', '   ', 'pcs')`,
          { replacements: { organizationId } },
        ),
      ),
    ).toBe("Products_name_check");
  });

  it("refuses to delete an organization that has a product", async () => {
    await insertProduct();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Organizations"')),
    ).toBe("Products_organizationId_fkey");
  });
});
