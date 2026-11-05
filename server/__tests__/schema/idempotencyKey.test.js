const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

const KEY = "3f2b8c1e-6d1a-4c55-9b0e-1a2b3c4d5e6f";
let organizationId;

const insertOrganization = async (slug) => {
  const [rows] = await getSequelize().query(
    `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', :slug) RETURNING "id"`,
    { replacements: { slug } },
  );
  return rows[0].id;
};

const insertKey = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "IdempotencyKeys" ("organizationId", "key", "endpoint")
     VALUES (:organizationId, :key, :endpoint)`,
    {
      replacements: {
        organizationId,
        key: KEY,
        endpoint: "POST /api/stock/receive",
        ...overrides,
      },
    },
  );

describe("IdempotencyKeys table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertOrganization("tokomaju");
  });

  afterAll(() => clearTables(getSequelize()));

  it("stores a key with createdAt and an empty resourceId", async () => {
    await insertKey();
    const [rows] = await getSequelize().query(
      'SELECT * FROM "IdempotencyKeys"',
    );

    expect(rows[0].resourceId).toBeNull();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0]).not.toHaveProperty("updatedAt");
  });

  it("refuses the same key for the same endpoint in one organization", async () => {
    await insertKey();
    expect(await constraintOf(insertKey())).toBe(
      "IdempotencyKeys_organizationId_key_endpoint_key",
    );
  });

  it("allows the same key for another endpoint", async () => {
    await insertKey();
    await insertKey({ endpoint: "POST /api/transfers" });
  });

  it("allows the same key and endpoint in another organization", async () => {
    await insertKey();
    await insertKey({ organizationId: await insertOrganization("lain") });
  });

  it("refuses a key that is not a UUID", async () => {
    await expect(insertKey({ key: "not-a-uuid" })).rejects.toThrow(
      /invalid input syntax for type uuid/,
    );
  });

  it("refuses an organization that does not exist", async () => {
    expect(
      await constraintOf(
        insertKey({ organizationId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("IdempotencyKeys_organizationId_fkey");
  });

  it("lets only one of two concurrent inserts of the same key win", async () => {
    const results = await Promise.allSettled([insertKey(), insertKey()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
