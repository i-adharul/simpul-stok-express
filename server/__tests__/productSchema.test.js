const { createProductSchema, updateProductSchema, productListQuerySchema } = require("../schemas/product.schema");
const validate = require("../middlewares/validate");

function run(schemas, parts) {
  const req = { params: {}, query: {}, headers: {}, body: {}, ...parts };
  let error;
  validate(schemas)(req, {}, (err) => {
    error = err;
  });
  return { error, valid: req.valid };
}
const paths = (error) => error.details.map((d) => d.path);

describe("createProductSchema", () => {
  const create = (body) => run({ body: createProductSchema }, { body });

  it("removes every space from the SKU, uppercases it and defaults minStock to 0", () => {
    const { valid } = create({ sku: " ab 12\tc-3 ", name: " Teh Botol ", unit: "btl" });

    expect(valid.body).toEqual({ sku: "AB12C-3", name: "Teh Botol", unit: "btl", minStock: 0 });
  });

  it.each(["bks", "ktk", "pcs", "btl", "jrg", "pak"])("accepts the unit %s", (unit) => {
    expect(create({ sku: "A", name: "B", unit }).error).toBeUndefined();
  });

  it.each([
    [{ name: "B", unit: "pcs" }, "sku"],
    [{ sku: "  ", name: "B", unit: "pcs" }, "sku"],
    [{ sku: "A".repeat(51), name: "B", unit: "pcs" }, "sku"],
    [{ sku: "A", unit: "pcs" }, "name"],
    [{ sku: "A", name: "B".repeat(101), unit: "pcs" }, "name"],
    [{ sku: "A", name: "B" }, "unit"],
    [{ sku: "A", name: "B", unit: "kg" }, "unit"],
    [{ sku: "A", name: "B", unit: "PCS" }, "unit"],
    [{ sku: "A", name: "B", unit: "pcs", minStock: -1 }, "minStock"],
    [{ sku: "A", name: "B", unit: "pcs", minStock: 1_000_000_001 }, "minStock"],
    [{ sku: "A", name: "B", unit: "pcs", minStock: 1.5 }, "minStock"],
    [{ sku: "A", name: "B", unit: "pcs", minStock: "5" }, "minStock"],
  ])("rejects %j at %s", (body, path) => {
    expect(paths(create(body).error)).toEqual([path]);
  });

  it("accepts the limits: SKU of 50 characters, minStock 0 and 1,000,000,000", () => {
    expect(create({ sku: "a".repeat(50), name: "B", unit: "pcs", minStock: 0 }).error).toBeUndefined();
    expect(create({ sku: "A", name: "B", unit: "pcs", minStock: 1_000_000_000 }).error).toBeUndefined();
  });

  it("rejects unknown fields, organizationId included", () => {
    const { error } = create({ sku: "A", name: "B", unit: "pcs", organizationId: "x", archived: true });

    expect(paths(error)).toEqual(["organizationId", "archived"]);
  });
});

describe("updateProductSchema", () => {
  const update = (body) => run({ body: updateProductSchema }, { body });

  it("accepts one field with the rules of create, and adds no default", () => {
    expect(update({ sku: " x 1 " }).valid.body).toEqual({ sku: "X1" });
    expect(update({ minStock: 0 }).valid.body).toEqual({ minStock: 0 });
    expect(update({ name: "N" }).valid.body).toEqual({ name: "N" });
  });

  it("rejects an empty body, an unknown field and bad values", () => {
    expect(update({}).error.status).toBe(400);
    expect(paths(update({ archived: true }).error)).toEqual(["archived"]);
    expect(paths(update({ unit: "kg" }).error)).toEqual(["unit"]);
    expect(paths(update({ minStock: -5 }).error)).toEqual(["minStock"]);
  });
});

describe("productListQuerySchema", () => {
  it("has the same defaults and limits as the warehouse list", () => {
    const { valid } = run({ query: productListQuerySchema }, { query: {} });
    expect(valid.query).toEqual({ page: 1, pageSize: 20, includeArchived: false });
    expect(run({ query: productListQuerySchema }, { query: { pageSize: "101" } }).error.status).toBe(400);
  });
});
