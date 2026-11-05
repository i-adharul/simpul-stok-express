const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { inTransaction } = require("../helpers/transaction");
const { MAX_QUANTITY } = require("../services/stockService");
const { MAX_ITEMS, assertTransferInput, assertWarehousesUsable, loadTransferItems, destinationQuantity } = require("../services/transferService");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return { status: error.status, code: error.code, details: error.details };
  }
  return null;
};
const valid = { fromWarehouseId: A, toWarehouseId: B, items: [{ productId: P1, quantity: 1 }] };

describe("assertTransferInput (400)", () => {
  it("accepts a valid input", () => {
    expect(codeOf(() => assertTransferInput(valid))).toBeNull();
    expect(codeOf(() => assertTransferInput({ ...valid, items: [{ productId: P1, quantity: 1000000 }] }))).toBeNull();
  });

  it("refuses a source equal to the destination", () => {
    const error = codeOf(() => assertTransferInput({ ...valid, toWarehouseId: A }));
    expect([error.status, error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect(error.details[0]).toMatchObject({ source: "body", path: "toWarehouseId" });
  });

  it("refuses 0 items and more than 50 items, and accepts exactly 50", () => {
    expect(codeOf(() => assertTransferInput({ ...valid, items: [] })).details[0].path).toBe("items");
    const many = (n) => Array.from({ length: n }, (_, i) => ({ productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    expect(codeOf(() => assertTransferInput({ ...valid, items: many(MAX_ITEMS + 1) })).details[0].path).toBe("items");
    expect(codeOf(() => assertTransferInput({ ...valid, items: many(MAX_ITEMS) }))).toBeNull();
  });

  it("refuses a product that appears twice, pointing at the second one", () => {
    const error = codeOf(() => assertTransferInput({ ...valid, items: [{ productId: P1, quantity: 1 }, { productId: P2, quantity: 1 }, { productId: P1, quantity: 2 }] }));
    expect(error.status).toBe(400);
    expect(error.details.map((d) => d.path)).toEqual(["items.2.productId"]);
  });

  it("refuses a quantity that is not a whole number from 1 to 1,000,000", () => {
    for (const quantity of [0, -1, 1.5, 1000001, "3", null, undefined]) {
      const error = codeOf(() => assertTransferInput({ ...valid, items: [{ productId: P1, quantity }] }));
      expect(error?.details[0].path).toBe("items.0.quantity");
    }
  });

  it("reports every problem at once", () => {
    const error = codeOf(() => assertTransferInput({ fromWarehouseId: A, toWarehouseId: A, items: [{ productId: P1, quantity: 0 }] }));
    expect(error.details.map((d) => d.path)).toEqual(["toWarehouseId", "items.0.quantity"]);
  });
});

describe("assertWarehousesUsable", () => {
  const active = { archivedAt: null };
  const archived = { archivedAt: new Date() };

  it("accepts two active warehouses", () => {
    expect(codeOf(() => assertWarehousesUsable({ source: active, destination: active }))).toBeNull();
  });

  it("answers 403 for a missing source, 409 for an archived source", () => {
    expect(codeOf(() => assertWarehousesUsable({ source: null, destination: active })).status).toBe(403);
    expect(codeOf(() => assertWarehousesUsable({ source: archived, destination: active }))).toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("answers 404 for a missing or foreign destination, 409 for an archived one", () => {
    expect(codeOf(() => assertWarehousesUsable({ source: active, destination: null }))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(codeOf(() => assertWarehousesUsable({ source: active, destination: archived }))).toMatchObject({ status: 409, code: "CONFLICT" });
  });
});

describe("destinationQuantity", () => {
  it("adds, and refuses a total above 2,147,483,647 with a 409", () => {
    expect(destinationQuantity(5, 3)).toBe(8);
    expect(destinationQuantity(MAX_QUANTITY - 1, 1)).toBe(MAX_QUANTITY);
    expect(codeOf(() => destinationQuantity(MAX_QUANTITY, 1))).toMatchObject({ status: 409, code: "CONFLICT" });
  });
});

describe("loadTransferItems (404 and 409)", () => {
  let world;
  let ctx;
  beforeEach(async () => {
    await clearTables(getSequelize());
    world = await createWorld();
    ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
  });
  afterAll(async () => {
    await clearTables(getSequelize());
    await db.sequelize.close();
  });

  const load = (items) => inTransaction((t) => loadTransferItems(ctx, items, t));
  const failure = async (promise) => {
    try {
      await promise;
    } catch (error) {
      return { status: error.status, code: error.code };
    }
    return null;
  };

  it("returns the items ordered by productId whatever the order sent", async () => {
    const ids = [await world.createProduct("A"), await world.createProduct("A"), await world.createProduct("A")];
    const sorted = [...ids].sort();
    const result = await load([...ids].reverse().map((productId, i) => ({ productId, quantity: i + 1 })));
    expect(result.map((item) => item.productId)).toEqual(sorted);
  });

  it("answers the same 404 for a product of another organization and one that does not exist", async () => {
    const foreign = await world.createProduct("B");
    const missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(await failure(load([{ productId: foreign, quantity: 1 }]))).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(await failure(load([{ productId: missing, quantity: 1 }]))).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("answers 409 for an archived product", async () => {
    const productId = await world.createProduct("A");
    await getSequelize().query(`UPDATE "Products" SET "archivedAt" = now() WHERE id = :productId`, { replacements: { productId } });
    expect(await failure(load([{ productId, quantity: 1 }]))).toEqual({ status: 409, code: "CONFLICT" });
  });

  it("lets the first problem in productId order win, not the first sent", async () => {
    const ok = await world.createProduct("A");
    const foreign = await world.createProduct("B");
    const archived = await world.createProduct("A");
    await getSequelize().query(`UPDATE "Products" SET "archivedAt" = now() WHERE id = :archived`, { replacements: { archived } });
    const [first, second] = [foreign, archived].sort();
    const expected = first === foreign ? 404 : 409;
    expect(second).toBeDefined();
    expect((await failure(load([{ productId: second, quantity: 1 }, { productId: ok, quantity: 1 }, { productId: first, quantity: 1 }]))).status).toBe(expected);
  });
});
