const db = require("../models");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");
const { AppError } = require("../helpers/errors");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

// Two organizations, one warehouse each; the caller is in A.
async function setup() {
  const a = await createOrganization("tokoa");
  const b = await createOrganization("tokob");
  const ctxA = { organizationId: a };
  const warehouseA = await tenant(ctxA).Warehouse.create({ code: "GD-A", name: "Gudang A" });
  const warehouseB = await tenant({ organizationId: b }).Warehouse.create({ code: "GD-B", name: "Gudang B" });
  return { ctxA, warehouseA, warehouseB };
}

const RANDOM_UUID = "33333333-3333-4333-8333-333333333333";

describe("findOwned", () => {
  it("returns the row when it belongs to the caller's organization", async () => {
    const { ctxA, warehouseA } = await setup();

    const found = await findOwned(ctxA, "Warehouse", warehouseA.id);

    expect(found.id).toBe(warehouseA.id);
    expect(found.code).toBe("GD-A");
  });

  it("throws 404 NOT_FOUND for an ID that does not exist", async () => {
    const { ctxA } = await setup();

    await expect(findOwned(ctxA, "Warehouse", RANDOM_UUID)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("throws 404 NOT_FOUND for an ID that belongs to another organization", async () => {
    const { ctxA, warehouseB } = await setup();

    await expect(findOwned(ctxA, "Warehouse", warehouseB.id)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it.each([["abc"], ["123"], [""], ["not-a-uuid-at-all"], ["33333333-3333-4333-8333-33333333333"], [" "], [null], [undefined], [42], [{}]])(
    "throws 404 NOT_FOUND for a value that is not a UUID: %j",
    async (id) => {
      const { ctxA } = await setup();

      const error = await findOwned(ctxA, "Warehouse", id).catch((e) => e);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ status: 404, code: "NOT_FOUND" });
    },
  );

  it("does not reach the database for a value that is not a UUID", async () => {
    // A non-UUID would make Postgres raise "invalid input syntax for type uuid" (a 500).
    const { ctxA } = await setup();
    const spy = jest.spyOn(db.Warehouse, "findOne");

    await findOwned(ctxA, "Warehouse", "abc").catch(() => {});

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("accepts the model by name or as the model class", async () => {
    const { ctxA, warehouseA } = await setup();

    expect((await findOwned(ctxA, db.Warehouse, warehouseA.id)).id).toBe(warehouseA.id);
  });

  it("passes options on (attributes, transaction)", async () => {
    const { ctxA, warehouseA } = await setup();

    const found = await findOwned(ctxA, "Warehouse", warehouseA.id, { attributes: ["id"] });

    expect(found.get({ plain: true })).toEqual({ id: warehouseA.id });
  });

  it("treats an unknown or global model as a programming error, not a 404", async () => {
    const { ctxA } = await setup();

    await expect(findOwned(ctxA, "Plan", RANDOM_UUID)).rejects.toThrow(/tenant model/);
    await expect(findOwned(ctxA, "Nope", RANDOM_UUID)).rejects.toThrow(/tenant model/);
  });
});
