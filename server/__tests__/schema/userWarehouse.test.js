const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

let organizationId;
let userId;
let warehouseId;

const insertAssignment = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "UserWarehouses" ("organizationId", "userId", "warehouseId")
     VALUES (:organizationId, :userId, :warehouseId)`,
    { replacements: { organizationId, userId, warehouseId, ...overrides } },
  );

const insertAndReturnId = async (sql, replacements) => {
  const [rows] = await getSequelize().query(`${sql} RETURNING "id"`, {
    replacements,
  });
  return rows[0].id;
};

describe("UserWarehouses table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await insertAndReturnId(
      `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', 'tokomaju')`,
    );
    userId = await insertAndReturnId(
      `INSERT INTO "Users" ("organizationId", "email", "name", "passwordHash", "role")
       VALUES (:organizationId, 'budi@example.com', 'Budi', 'hash', 'VIEWER')`,
      { organizationId },
    );
    warehouseId = await insertAndReturnId(
      `INSERT INTO "Warehouses" ("organizationId", "code", "name")
       VALUES (:organizationId, 'GD-01', 'Gudang Utama')`,
      { organizationId },
    );
  });

  afterAll(() => clearTables(getSequelize()));

  it("stores an assignment with a generated id", async () => {
    await insertAssignment();
    const [rows] = await getSequelize().query('SELECT * FROM "UserWarehouses"');

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses the same user on the same warehouse twice", async () => {
    await insertAssignment();
    expect(await constraintOf(insertAssignment())).toBe(
      "UserWarehouses_userId_warehouseId_key",
    );
  });

  it("refuses a user that does not exist", async () => {
    expect(
      await constraintOf(
        insertAssignment({ userId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("UserWarehouses_userId_fkey");
  });

  it("refuses a warehouse that does not exist", async () => {
    expect(
      await constraintOf(
        insertAssignment({
          warehouseId: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("UserWarehouses_warehouseId_fkey");
  });

  it("refuses to delete a warehouse that has an assignment", async () => {
    await insertAssignment();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Warehouses"')),
    ).toBe("UserWarehouses_warehouseId_fkey");
  });
});
