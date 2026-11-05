const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");
const { createOrganization, createUser } = require("../support/factories");

let organizationId;
let userId;

const insertNotification = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Notifications" ("organizationId", "userId", "type", "message")
     VALUES (:organizationId, :userId, CAST(:type AS "enum_Notifications_type"), :message)`,
    {
      replacements: {
        organizationId,
        userId,
        type: "LOW_STOCK",
        message: "Stok Indomie menipis",
        ...overrides,
      },
    },
  );

describe("Notifications table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await createOrganization();
    userId = await createUser(organizationId);
  });

  afterAll(() => clearTables(getSequelize()));

  it("starts unread", async () => {
    await insertNotification();
    const [rows] = await getSequelize().query('SELECT * FROM "Notifications"');

    expect(rows[0].readAt).toBeNull();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each(["LOW_STOCK", "INVOICE_DUE", "TRIAL_ENDING", "SUSPENDED"])(
    "accepts the type %s",
    async (type) => {
      await insertNotification({ type });
    },
  );

  it("refuses a type outside the enum", async () => {
    await expect(insertNotification({ type: "NEWS" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses a blank message and a message over 255 characters", async () => {
    expect(await constraintOf(insertNotification({ message: "  " }))).toBe(
      "Notifications_message_check",
    );
    await expect(
      insertNotification({ message: "x".repeat(256) }),
    ).rejects.toThrow(/value too long/);
  });

  it("refuses a recipient that does not exist", async () => {
    expect(
      await constraintOf(
        insertNotification({ userId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("Notifications_userId_fkey");
  });

  it("has a composite index that starts with organizationId", async () => {
    const [rows] = await getSequelize().query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'Notifications_organizationId_userId_createdAt_idx'`,
    );

    expect(rows[0].indexdef).toMatch(
      /\("organizationId", "userId", "createdAt"\)/,
    );
  });
});
