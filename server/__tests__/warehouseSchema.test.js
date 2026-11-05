const { createWarehouseSchema, updateWarehouseSchema, warehouseListQuerySchema } = require("../schemas/warehouse.schema");
const validate = require("../middlewares/validate");

// Runs a schema through the real validate middleware, so unknown keys behave as in a route.
function run(schemas, parts) {
  const req = { params: {}, query: {}, headers: {}, body: {}, ...parts };
  let error;
  validate(schemas)(req, {}, (err) => {
    error = err;
  });
  return { error, valid: req.valid };
}
const paths = (error) => error.details.map((d) => d.path);

describe("createWarehouseSchema", () => {
  const create = (body) => run({ body: createWarehouseSchema }, { body });

  it("trims, uppercases the code and keeps the rest", () => {
    const { valid } = create({ code: "  gd-sudirman ", name: " Gudang Sudirman ", address: " Jl. A " });

    expect(valid.body).toEqual({ code: "GD-SUDIRMAN", name: "Gudang Sudirman", address: "Jl. A" });
  });

  it("stores an empty or blank address as null and allows no address at all", () => {
    expect(create({ code: "A", name: "B", address: "   " }).valid.body.address).toBeNull();
    expect(create({ code: "A", name: "B" }).valid.body).toEqual({ code: "A", name: "B" });
  });

  it.each([
    [{ name: "B" }, "code"],
    [{ code: "   ", name: "B" }, "code"],
    [{ code: "A".repeat(21), name: "B" }, "code"],
    [{ code: "A" }, "name"],
    [{ code: "A", name: "B".repeat(101) }, "name"],
    [{ code: "A", name: "B", address: "x".repeat(256) }, "address"],
    [{ code: 5, name: "B" }, "code"],
  ])("rejects %j at %s", (body, path) => {
    expect(paths(create(body).error)).toContain(path);
  });

  it("accepts the limits: a code of 20 characters, a name of 100, an address of 255", () => {
    const { error } = create({ code: "a".repeat(20), name: "b".repeat(100), address: "c".repeat(255) });

    expect(error).toBeUndefined();
  });

  it("measures the code after uppercasing (a letter that grows counts at its new size)", () => {
    expect(paths(create({ code: "ß".repeat(11), name: "B" }).error)).toEqual(["code"]);
  });

  it("rejects unknown fields, organizationId included", () => {
    const { error } = create({ code: "A", name: "B", organizationId: "x", extra: 1 });

    expect(paths(error)).toEqual(["organizationId", "extra"]);
  });
});

describe("updateWarehouseSchema", () => {
  const update = (body) => run({ body: updateWarehouseSchema }, { body });

  it("accepts one field and applies the same rules as create", () => {
    expect(update({ code: " gd-2 " }).valid.body).toEqual({ code: "GD-2" });
    expect(update({ address: "" }).valid.body).toEqual({ address: null });
  });

  it("rejects an empty body", () => {
    expect(update({}).error.status).toBe(400);
  });

  it("rejects unknown fields (archived comes with E3-03) and bad values", () => {
    expect(paths(update({ organizationId: "x" }).error)).toContain("organizationId");
    expect(paths(update({ name: "" }).error)).toEqual(["name"]);
    expect(paths(update({ code: "A".repeat(21) }).error)).toEqual(["code"]);
  });
});

describe("warehouseListQuerySchema", () => {
  const list = (query) => run({ query: warehouseListQuerySchema }, { query });

  it("has defaults: page 1, pageSize 20, includeArchived false", () => {
    expect(list({}).valid.query).toEqual({ page: 1, pageSize: 20, includeArchived: false });
  });

  it("reads numbers and booleans from strings", () => {
    expect(list({ page: "3", pageSize: "100", includeArchived: "true" }).valid.query).toEqual({
      page: 3,
      pageSize: 100,
      includeArchived: true,
    });
  });

  it.each([
    [{ page: "0" }, "page"],
    [{ page: "-1" }, "page"],
    [{ page: "abc" }, "page"],
    [{ page: "1.5" }, "page"],
    [{ page: "" }, "page"],
    [{ pageSize: "0" }, "pageSize"],
    [{ pageSize: "101" }, "pageSize"],
    [{ includeArchived: "yes" }, "includeArchived"],
    [{ includeArchived: "TRUE" }, "includeArchived"],
    [{ page: ["1", "2"] }, "page"],
  ])("rejects %j", (query, path) => {
    expect(paths(list(query).error)).toEqual([path]);
  });

  it("rejects unknown query keys such as organizationId", () => {
    expect(paths(list({ organizationId: "x" }).error)).toEqual(["organizationId"]);
  });
});
