const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");
const { createOrganization, createUser } = require("../support/factories");

let organizationId;
let createdById;

const insertInvitation = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Invitations" ("organizationId", "email", "role", "tokenHash", "expiresAt", "createdById")
     VALUES (:organizationId, :email, CAST(:role AS "enum_Invitations_role"), :tokenHash,
             now() + interval '7 days', :createdById)`,
    {
      replacements: {
        organizationId,
        createdById,
        email: "sari@example.com",
        role: "VIEWER",
        tokenHash: "hash-1",
        ...overrides,
      },
    },
  );

describe("Invitations table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await createOrganization();
    createdById = await createUser(organizationId);
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults: no warehouses, not accepted", async () => {
    await insertInvitation();
    const [rows] = await getSequelize().query('SELECT * FROM "Invitations"');

    expect(rows[0].warehouseIds).toEqual([]);
    expect(rows[0].acceptedAt).toBeNull();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])(
    "accepts the role %s",
    async (role) => {
      await insertInvitation({ role });
    },
  );

  it.each(["OWNER", "PLATFORM_ADMIN"])(
    "refuses the role %s: the Owner cannot be invited",
    async (role) => {
      await expect(insertInvitation({ role })).rejects.toThrow(
        /invalid input value for enum/,
      );
    },
  );

  it("stores a list of warehouse IDs", async () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    await getSequelize().query(
      `INSERT INTO "Invitations" ("organizationId", "email", "role", "tokenHash", "expiresAt", "createdById", "warehouseIds")
       VALUES (:organizationId, 'a@example.com', 'VIEWER', 'h', now() + interval '1 day', :createdById, CAST(:ids AS uuid[]))`,
      {
        replacements: {
          organizationId,
          createdById,
          ids: `{${ids.join(",")}}`,
        },
      },
    );
    const [rows] = await getSequelize().query(
      'SELECT "warehouseIds" FROM "Invitations"',
    );

    expect(rows[0].warehouseIds).toEqual(ids);
  });

  it("refuses a token hash that is already used", async () => {
    await insertInvitation();
    expect(
      await constraintOf(insertInvitation({ email: "lain@example.com" })),
    ).toBe("Invitations_tokenHash_key");
  });

  it("refuses an email with capital letters", async () => {
    expect(
      await constraintOf(insertInvitation({ email: "Sari@Example.com" })),
    ).toBe("Invitations_email_lowercase_check");
  });

  it("refuses an invitation that expires before it is created", async () => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Invitations" ("organizationId", "email", "role", "tokenHash", "expiresAt", "createdById")
           VALUES (:organizationId, 'x@example.com', 'VIEWER', 'h2', now() - interval '1 day', :createdById)`,
          { replacements: { organizationId, createdById } },
        ),
      ),
    ).toBe("Invitations_expiresAt_check");
  });

  it("refuses a creator that does not exist", async () => {
    expect(
      await constraintOf(
        insertInvitation({
          createdById: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("Invitations_createdById_fkey");
  });

  it("can be deleted: a cancelled invitation is removed (docs/03 E03)", async () => {
    await insertInvitation();
    await getSequelize().query('DELETE FROM "Invitations"');
    const [rows] = await getSequelize().query('SELECT * FROM "Invitations"');

    expect(rows).toEqual([]);
  });
});
