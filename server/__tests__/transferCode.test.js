const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { constraintOf } = require("./support/constraintOf");
const { createWorld } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { formatTransferCode, nextTransferCode } = require("../services/transferCode");

let world;
let warehouses;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  warehouses = { A: [await world.createWarehouse("A"), await world.createWarehouse("A")], B: [await world.createWarehouse("B"), await world.createWarehouse("B")] };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const ctxOf = (organization) => ({ userId: world.users[organization].OWNER.id, organizationId: world.organizations[organization], role: "OWNER", warehouseIds: [] });
const insertTransfer = (organization, code) =>
  getSequelize().query(
    `INSERT INTO "StockTransfers" ("organizationId", "code", "fromWarehouseId", "toWarehouseId") VALUES (:organizationId, :code, :from, :to)`,
    { replacements: { organizationId: world.organizations[organization], code, from: warehouses[organization][0], to: warehouses[organization][1] } },
  );

describe("formatTransferCode", () => {
  it("pads to four digits", () => {
    expect([1, 9, 10, 123, 9999].map(formatTransferCode)).toEqual(["MT-0001", "MT-0009", "MT-0010", "MT-0123", "MT-9999"]);
  });

  it("grows past four digits instead of cutting the number", () => {
    expect(formatTransferCode(10000)).toBe("MT-10000");
  });
});

describe("nextTransferCode", () => {
  it("is MT-0001 for an organization without transfers", async () => {
    expect(await inTransaction((t) => nextTransferCode(ctxOf("A"), t))).toBe("MT-0001");
  });

  it("is the number of the organization's transfers plus one", async () => {
    await insertTransfer("A", "MT-0001");
    await insertTransfer("A", "MT-0002");
    expect(await inTransaction((t) => nextTransferCode(ctxOf("A"), t))).toBe("MT-0003");
  });

  it("counts per organization: the transfers of another organization do not move the number", async () => {
    await insertTransfer("B", "MT-0001");
    await insertTransfer("B", "MT-0002");
    expect(await inTransaction((t) => nextTransferCode(ctxOf("A"), t))).toBe("MT-0001");
    expect(await inTransaction((t) => nextTransferCode(ctxOf("B"), t))).toBe("MT-0003");
  });

  it("sees the rows its own transaction wrote", async () => {
    const code = await inTransaction(async (t) => {
      await db.StockTransfer.create({ organizationId: world.organizations.A, code: "MT-0001", fromWarehouseId: warehouses.A[0], toWarehouseId: warehouses.A[1] }, { transaction: t });
      return nextTransferCode(ctxOf("A"), t);
    });
    expect(code).toBe("MT-0002");
  });

  it("is only a proposal: the unique index (organizationId, code) is what refuses a duplicate", async () => {
    await insertTransfer("A", "MT-0001");
    expect(await constraintOf(insertTransfer("A", "MT-0001"))).toBe("StockTransfers_organizationId_code_key");
    await expect(insertTransfer("B", "MT-0001")).resolves.toBeDefined();
  });
});
