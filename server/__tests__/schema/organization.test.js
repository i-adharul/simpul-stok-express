const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");

const insertOrganization = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Organizations" ("name", "slug", "status")
     VALUES (:name, :slug, COALESCE(CAST(:status AS "enum_Organizations_status"), 'TRIAL'))`,
    {
      replacements: {
        name: "Toko Maju",
        slug: "tokomaju",
        status: null,
        ...overrides,
      },
    },
  );

describe("Organizations table", () => {
  beforeEach(async () => {
    await getSequelize().query('DELETE FROM "Users"');
    await getSequelize().query('DELETE FROM "Organizations"');
  });

  it("starts in TRIAL and creates id and timestamps in the database", async () => {
    await insertOrganization();
    const [rows] = await getSequelize().query('SELECT * FROM "Organizations"');

    expect(rows[0].status).toBe("TRIAL");
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].address).toBeNull();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it.each(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED"])(
    "accepts status %s",
    async (status) => {
      await insertOrganization({ status });
    },
  );

  it("refuses a status outside the enum", async () => {
    await expect(insertOrganization({ status: "DELETED" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses a duplicate slug", async () => {
    await insertOrganization();
    expect(await constraintOf(insertOrganization({ name: "Other" }))).toBe(
      "Organizations_slug_key",
    );
  });

  it.each(["ab", "Toko", "toko-maju", "toko maju"])(
    "refuses the slug %j",
    async (slug) => {
      expect(await constraintOf(insertOrganization({ slug }))).toBe(
        "Organizations_slug_check",
      );
    },
  );

  it("refuses a slug of 31 characters (the column is varchar(30))", async () => {
    await expect(insertOrganization({ slug: "a".repeat(31) })).rejects.toThrow(
      /too long/,
    );
  });

  it("accepts a slug of 3 and of 30 characters", async () => {
    await insertOrganization({ slug: "abc" });
    await insertOrganization({ slug: "a".repeat(30), name: "Long" });
  });
});
