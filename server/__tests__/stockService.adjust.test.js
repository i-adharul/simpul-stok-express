const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createStockLevel } = require("./support/factories");

// The tenant data access is wrapped so one test can change the stock row between the service's read
// and its conditional update (a write that bypassed the warehouse lock).
let mockInterfere = null;
jest.mock("../helpers/tenantScope", () => {
  const real = jest.requireActual("../helpers/tenantScope");
  return {
    ...real,
    tenant: (ctx) => {
      const scoped = real.tenant(ctx);
      return {
        ...scoped,
        StockLevel: {
          ...scoped.StockLevel,
          findOne: async (options) => {
            const row = await scoped.StockLevel.findOne(options);
            if (mockInterfere && row) await mockInterfere(row);
            return row;
          },
        },
      };
    },
  };
});

const { inTransaction } = require("../helpers/transaction");
const stockService = require("../services/stockService");

jest.setTimeout(60000);

let world;
let ctx;
beforeEach(async () => {
  mockInterfere = null;
  await clearTables(getSequelize());
  world = await createWorld();
  ctx = { userId: world.users.A.OWNER.id, organizationId: world.organizations.A, role: "OWNER", warehouseIds: [] };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const adjust = (input) => inTransaction((transaction) => stockService.adjust(ctx, { reason: "CORRECTION", ...input }, transaction));
const quantity = async (warehouseId, productId) =>
  (await sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0]?.quantity;
const movements = () => sql(`SELECT * FROM "StockMovements"`);
const pair = async (stock) => {
  const warehouseId = await world.createWarehouse("A");
  const productId = await world.createProduct("A");
  if (stock !== undefined) await createStockLevel(ctx.organizationId, warehouseId, productId, stock);
  return { warehouseId, productId };
};

describe("stockService.adjust", () => {
  it("SET writes the counted quantity and the movement holds the signed difference", async () => {
    const p = await pair(10);
    const id = await adjust({ ...p, mode: "SET", value: 4, reason: "LOST" });
    expect(await quantity(p.warehouseId, p.productId)).toBe(4);
    expect(await movements()).toEqual([expect.objectContaining({ id, type: "ADJUST", quantityDelta: -6, reason: "LOST" })]);
  });

  it("DELTA adds to the current quantity", async () => {
    const p = await pair(10);
    await adjust({ ...p, mode: "DELTA", value: 5 });
    expect(await quantity(p.warehouseId, p.productId)).toBe(15);
  });

  it("a result equal to the current quantity is a 400 with a body detail", async () => {
    const p = await pair(10);
    await expect(adjust({ ...p, mode: "SET", value: 10 })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400, details: [expect.objectContaining({ path: "value" })] });
    expect(await movements()).toHaveLength(0);
  });

  it("a negative result is a 409 and changes nothing", async () => {
    const p = await pair(3);
    await expect(adjust({ ...p, mode: "DELTA", value: -4 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(await quantity(p.warehouseId, p.productId)).toBe(3);
  });

  it("a result above the column limit is a 409", async () => {
    const p = await pair(2147483647);
    await expect(adjust({ ...p, mode: "DELTA", value: 1 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("works on an archived product, but not on an archived warehouse (409)", async () => {
    const p = await pair(5);
    await sql(`UPDATE "Products" SET "archivedAt" = now() WHERE id = :id`, { id: p.productId });
    await adjust({ ...p, mode: "SET", value: 0 });
    expect(await quantity(p.warehouseId, p.productId)).toBe(0);

    await sql(`UPDATE "Warehouses" SET "archivedAt" = now() WHERE id = :id`, { id: p.warehouseId });
    await expect(adjust({ ...p, mode: "SET", value: 3 })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("a foreign or missing product is a 404, a foreign warehouse a 403", async () => {
    const p = await pair(1);
    const foreignProduct = await world.createProduct("B");
    const foreignWarehouse = await world.createWarehouse("B");
    await expect(adjust({ ...p, productId: foreignProduct, mode: "SET", value: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adjust({ ...p, warehouseId: foreignWarehouse, mode: "SET", value: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("answers 409 'Stok berubah saat disesuaikan. Coba lagi.' when the row changed after it was read, and rolls back", async () => {
    const p = await pair(10);
    mockInterfere = async () => {
      mockInterfere = null;
      await sql(`UPDATE "StockLevels" SET quantity = 99 WHERE "warehouseId" = :warehouseId`, { warehouseId: p.warehouseId });
    };

    await expect(adjust({ ...p, mode: "SET", value: 4 })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "Stok berubah saat disesuaikan. Coba lagi.",
    });
    expect(await quantity(p.warehouseId, p.productId)).toBe(99); // the outside change stands, ours was not applied
    expect(await movements()).toHaveLength(0);
  });
});
