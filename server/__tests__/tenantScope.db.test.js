const db = require("../models");
const { tenant } = require("../helpers/tenantScope");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const rowsOf = async (table) =>
  (await getSequelize().query(`SELECT * FROM "${table}" ORDER BY "code"`))[0];

describe("create always takes organizationId from the context", () => {
  it("fills it when the input has none", async () => {
    const org = await createOrganization("tokosaya");

    const warehouse = await tenant({ organizationId: org }).Warehouse.create({ code: "GD-1", name: "Gudang 1" });

    expect(warehouse.organizationId).toBe(org);
    expect((await rowsOf("Warehouses"))[0].organizationId).toBe(org);
  });

  it("ignores an organizationId in the input and writes the caller's own", async () => {
    const mine = await createOrganization("tokosaya");
    const theirs = await createOrganization("tokolain");

    await tenant({ organizationId: mine }).Warehouse.create({
      code: "GD-1",
      name: "Gudang 1",
      organizationId: theirs,
    });

    const rows = await rowsOf("Warehouses");
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(mine);
  });

  it("runs inside a transaction when one is passed and rolls back with it", async () => {
    const org = await createOrganization("tokosaya");

    const t = await db.sequelize.transaction();
    await tenant({ organizationId: org }).Warehouse.create({ code: "GD-1", name: "Gudang 1" }, { transaction: t });
    await t.rollback();

    expect(await rowsOf("Warehouses")).toHaveLength(0);
  });
});
