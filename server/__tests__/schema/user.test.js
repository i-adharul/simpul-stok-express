const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");

let organizationId;

const insertUser = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role",
                          "resetTokenHash", "resetExpiresAt")
     VALUES (:organizationId, :email, 'Budi', 'hash', CAST(:role AS "enum_Users_role"),
             :resetTokenHash, :resetExpiresAt)`,
    {
      replacements: {
        organizationId,
        email: "budi@example.com",
        role: "OWNER",
        resetTokenHash: null,
        resetExpiresAt: null,
        ...overrides,
      },
    },
  );

describe("Users table", () => {
  beforeEach(async () => {
    const sequelize = getSequelize();
    await sequelize.query('DELETE FROM "Users"');
    await sequelize.query('DELETE FROM "Organizations"');
    const [rows] = await sequelize.query(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko Maju', 'tokomaju') RETURNING "id"`,
    );
    organizationId = rows[0].id;
  });

  // Leave the tables empty: other test files delete organizations and would hit the foreign key.
  afterAll(async () => {
    await getSequelize().query('DELETE FROM "Users"');
    await getSequelize().query('DELETE FROM "Organizations"');
  });

  it("fills the defaults in the database", async () => {
    await insertUser();
    const [rows] = await getSequelize().query('SELECT * FROM "Users"');

    expect(rows[0].isActive).toBe(true);
    expect(rows[0].lastLoginAt).toBeNull();
    expect(rows[0].passwordChangedAt).toBeNull();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])(
    "accepts role %s inside an organization",
    async (role) => {
      await insertUser({ role });
    },
  );

  it("refuses a role outside the enum", async () => {
    await expect(insertUser({ role: "ADMIN" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("accepts a platform admin without an organization", async () => {
    await insertUser({ role: "PLATFORM_ADMIN", organizationId: null });
  });

  it("refuses a platform admin that belongs to an organization", async () => {
    expect(await constraintOf(insertUser({ role: "PLATFORM_ADMIN" }))).toBe(
      "Users_role_organization_check",
    );
  });

  it("refuses a tenant user without an organization", async () => {
    expect(await constraintOf(insertUser({ organizationId: null }))).toBe(
      "Users_role_organization_check",
    );
  });

  it("refuses an organization that does not exist", async () => {
    expect(
      await constraintOf(
        insertUser({ organizationId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("Users_organizationId_fkey");
  });

  it("refuses an email with capital letters", async () => {
    expect(await constraintOf(insertUser({ email: "Budi@Example.com" }))).toBe(
      "Users_email_lowercase_check",
    );
  });

  it("refuses a duplicate email", async () => {
    await insertUser();
    expect(await constraintOf(insertUser({ role: "VIEWER" }))).toBe(
      "Users_email_key",
    );
  });

  it("accepts the reset columns filled together or both empty", async () => {
    await insertUser({ resetTokenHash: "abc", resetExpiresAt: new Date() });
  });

  it("refuses a reset token without an expiry, and the other way round", async () => {
    expect(await constraintOf(insertUser({ resetTokenHash: "abc" }))).toBe(
      "Users_reset_pair_check",
    );
    expect(await constraintOf(insertUser({ resetExpiresAt: new Date() }))).toBe(
      "Users_reset_pair_check",
    );
  });

  it("refuses to delete an organization that still has users", async () => {
    await insertUser();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Organizations"')),
    ).toBe("Users_organizationId_fkey");
  });
});
