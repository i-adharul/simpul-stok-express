const { Op } = require("sequelize");
const db = require("../models");
const { tenant, scopeModel, scopeWhere } = require("../helpers/tenantScope");

afterAll(() => db.sequelize.close());

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// A stand-in for a Sequelize model: it only records what it was asked, so these tests prove what
// the wrapper sends without a database (the real data is checked in tenantScope.db.test.js).
const fakeModel = () => ({
  primaryKeyAttribute: "id",
  findAll: jest.fn().mockResolvedValue(["all"]),
  findOne: jest.fn().mockResolvedValue("one"),
  count: jest.fn().mockResolvedValue(3),
  create: jest.fn().mockResolvedValue("created"),
  update: jest.fn().mockResolvedValue([1]),
});

describe("scopeWhere", () => {
  it("ANDs the caller's filter with the organization", () => {
    expect(scopeWhere({ code: "GD-1" }, ORG)).toEqual({
      [Op.and]: [{ code: "GD-1" }, { organizationId: ORG }],
    });
  });

  it("works without a caller filter", () => {
    expect(scopeWhere(undefined, ORG)).toEqual({ [Op.and]: [{}, { organizationId: ORG }] });
  });

  it("keeps the organization filter even when the caller filters on another one", () => {
    const where = scopeWhere({ organizationId: OTHER }, ORG);

    // Both conditions must hold, so a row of OTHER can never match.
    expect(where[Op.and]).toContainEqual({ organizationId: ORG });
    expect(where[Op.and]).toContainEqual({ organizationId: OTHER });
  });

  it("keeps the organization filter when the caller filter is an OR", () => {
    const where = scopeWhere({ [Op.or]: [{ code: "A" }, { code: "B" }] }, ORG);

    expect(where[Op.and][1]).toEqual({ organizationId: ORG });
  });
});

describe("scopeModel injects the organization into every method", () => {
  it.each(["findAll", "findOne", "count"])("%s", async (method) => {
    const Model = fakeModel();

    await scopeModel(Model, ORG)[method]({ where: { code: "GD-1" }, order: [["code", "ASC"]] });

    expect(Model[method]).toHaveBeenCalledWith({
      where: scopeWhere({ code: "GD-1" }, ORG),
      order: [["code", "ASC"]],
    });
  });

  it.each(["findAll", "findOne", "count"])("%s works with no options at all", async (method) => {
    const Model = fakeModel();

    await scopeModel(Model, ORG)[method]();

    expect(Model[method]).toHaveBeenCalledWith({ where: scopeWhere(undefined, ORG) });
  });

  it("findByPk becomes a scoped findOne on the primary key", async () => {
    const Model = fakeModel();

    const result = await scopeModel(Model, ORG).findByPk("abc", { attributes: ["id"] });

    expect(result).toBe("one");
    expect(Model.findOne).toHaveBeenCalledWith({
      attributes: ["id"],
      where: scopeWhere({ id: "abc" }, ORG),
    });
  });

  it("findByPk without an id answers null and does not query", async () => {
    const Model = fakeModel();

    expect(await scopeModel(Model, ORG).findByPk(undefined)).toBeNull();
    expect(Model.findOne).not.toHaveBeenCalled();
  });

  it("create adds the organization to the values", async () => {
    const Model = fakeModel();

    await scopeModel(Model, ORG).create({ code: "GD-1" }, { transaction: "t" });

    expect(Model.create).toHaveBeenCalledWith({ code: "GD-1", organizationId: ORG }, { transaction: "t" });
  });

  it("update scopes the where and keeps the options (transaction)", async () => {
    const Model = fakeModel();

    const result = await scopeModel(Model, ORG).update({ name: "Baru" }, { where: { id: "abc" }, transaction: "t" });

    expect(result).toEqual([1]);
    expect(Model.update).toHaveBeenCalledWith(
      { name: "Baru" },
      { where: scopeWhere({ id: "abc" }, ORG), transaction: "t" },
    );
  });

  it("exposes only these six methods", () => {
    expect(Object.keys(scopeModel(fakeModel(), ORG)).sort()).toEqual(
      ["count", "create", "findAll", "findByPk", "findOne", "update"],
    );
  });
});

describe("tenant(ctx)", () => {
  it("offers the tenant models, scoped", () => {
    const scoped = tenant({ organizationId: ORG });

    expect(Object.keys(scoped)).toEqual(
      expect.arrayContaining(["Warehouse", "Product", "StockLevel", "StockMovement", "User"]),
    );
    expect(typeof scoped.Warehouse.findAll).toBe("function");
  });

  it("does not offer models that have no organizationId (Plan, WebhookEvent) or the raw Sequelize objects", () => {
    const scoped = tenant({ organizationId: ORG });

    for (const name of ["Plan", "WebhookEvent", "Organization", "sequelize", "Sequelize"]) {
      expect(scoped[name]).toBeUndefined();
    }
  });

  it.each([[undefined], [null], [{}], [{ organizationId: null }], [{ organizationId: "" }]])(
    "refuses a context without an organization: %j",
    (ctx) => {
      expect(() => tenant(ctx)).toThrow(/organizationId/);
    },
  );
});
