const { Op } = require("sequelize");
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

describe("bulkCreate takes organizationId from the context for every row", () => {
  it("writes the caller's organization on all rows and ignores an organizationId in the input", async () => {
    const mine = await createOrganization("tokosaya");
    const theirs = await createOrganization("tokolain");

    await tenant({ organizationId: mine }).Warehouse.bulkCreate([
      { code: "GD-1", name: "Gudang 1" },
      { code: "GD-2", name: "Gudang 2", organizationId: theirs },
    ]);

    const rows = await rowsOf("Warehouses");
    expect(rows.map((row) => [row.code, row.organizationId])).toEqual([["GD-1", mine], ["GD-2", mine]]);
  });

  it("rolls back with the transaction it is given", async () => {
    const org = await createOrganization("tokosaya");

    const t = await db.sequelize.transaction();
    await tenant({ organizationId: org }).Warehouse.bulkCreate([{ code: "GD-1", name: "Gudang 1" }], { transaction: t });
    await t.rollback();

    expect(await rowsOf("Warehouses")).toHaveLength(0);
  });
});

describe("two organizations: the wrapper returns and changes only its own data", () => {
  let a, b, ctxA, ctxB, aWarehouse, bWarehouse;

  beforeEach(async () => {
    a = await createOrganization("tokoa");
    b = await createOrganization("tokob");
    ctxA = { organizationId: a };
    ctxB = { organizationId: b };
    aWarehouse = await tenant(ctxA).Warehouse.create({ code: "GD-A", name: "Gudang A" });
    bWarehouse = await tenant(ctxB).Warehouse.create({ code: "GD-B", name: "Gudang B" });
    await tenant(ctxA).Product.create({ sku: "SKU-1", name: "Gula", unit: "pcs" });
    await tenant(ctxB).Product.create({ sku: "SKU-1", name: "Kopi", unit: "pcs" });
  });

  it("findAll lists only the caller's rows", async () => {
    const rows = await tenant(ctxA).Warehouse.findAll();

    expect(rows.map((row) => row.code)).toEqual(["GD-A"]);
  });

  it("findAll cannot be widened with an OR or an explicit organizationId", async () => {
    const or = await tenant(ctxA).Warehouse.findAll({
      where: { [Op.or]: [{ code: "GD-A" }, { code: "GD-B" }] },
    });
    const explicit = await tenant(ctxA).Warehouse.findAll({ where: { organizationId: b } });

    expect(or.map((row) => row.code)).toEqual(["GD-A"]);
    expect(explicit).toEqual([]);
  });

  it("findOne finds its own row and not another organization's row with the same filter", async () => {
    expect((await tenant(ctxA).Product.findOne({ where: { sku: "SKU-1" } })).name).toBe("Gula");
    expect((await tenant(ctxB).Product.findOne({ where: { sku: "SKU-1" } })).name).toBe("Kopi");
    expect(await tenant(ctxA).Warehouse.findOne({ where: { code: "GD-B" } })).toBeNull();
  });

  it("findByPk answers null for the other organization's ID, like for an unknown ID", async () => {
    expect((await tenant(ctxA).Warehouse.findByPk(aWarehouse.id)).code).toBe("GD-A");
    expect(await tenant(ctxA).Warehouse.findByPk(bWarehouse.id)).toBeNull();
    expect(await tenant(ctxA).Warehouse.findByPk("33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("count counts only the caller's rows", async () => {
    expect(await tenant(ctxA).Warehouse.count()).toBe(1);
    expect(await tenant(ctxA).Warehouse.count({ where: { code: "GD-B" } })).toBe(0);
  });

  it("update changes its own row", async () => {
    const [changed] = await tenant(ctxA).Warehouse.update({ name: "Baru" }, { where: { id: aWarehouse.id } });

    expect(changed).toBe(1);
    expect((await tenant(ctxA).Warehouse.findByPk(aWarehouse.id)).name).toBe("Baru");
  });

  it("update on the other organization's row changes nothing", async () => {
    const [changed] = await tenant(ctxA).Warehouse.update({ name: "Dibajak" }, { where: { id: bWarehouse.id } });

    expect(changed).toBe(0);
    expect((await tenant(ctxB).Warehouse.findByPk(bWarehouse.id)).name).toBe("Gudang B");
  });

  it("update with no where at all changes only the caller's rows", async () => {
    await tenant(ctxA).Warehouse.update({ name: "Semua" }, { where: {} });

    expect((await tenant(ctxB).Warehouse.findByPk(bWarehouse.id)).name).toBe("Gudang B");
  });

  it("update cannot move a row to another organization", async () => {
    await tenant(ctxA).Warehouse.update({ organizationId: b }, { where: { id: aWarehouse.id } });

    expect((await tenant(ctxA).Warehouse.findByPk(aWarehouse.id)).organizationId).toBe(a);
    expect(await tenant(ctxB).Warehouse.count()).toBe(1);
  });

  it("the same SKU in two organizations stays separate", async () => {
    expect(await tenant(ctxA).Product.count()).toBe(1);
    expect(await tenant(ctxB).Product.count()).toBe(1);
  });
});
