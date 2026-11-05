const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");
const { createOrganization, createUser } = require("../support/factories");

let organizationId;
let actorId;

const insertLog = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "AuditLogs" ("organizationId", "actorId", "action", "entityType")
     VALUES (:organizationId, :actorId, :action, 'StockTransfer')`,
    {
      replacements: {
        organizationId,
        actorId,
        action: "stock.transfer.create",
        ...overrides,
      },
    },
  );

describe("AuditLogs table", () => {
  beforeEach(async () => {
    await clearTables(getSequelize());
    organizationId = await createOrganization();
    actorId = await createUser(organizationId);
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults: empty metadata, createdAt, no updatedAt", async () => {
    await insertLog();
    const [rows] = await getSequelize().query('SELECT * FROM "AuditLogs"');

    expect(rows[0].metadata).toEqual({});
    expect(rows[0].entityId).toBeNull();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0]).not.toHaveProperty("updatedAt");
  });

  it("accepts an action by the system (no actor)", async () => {
    await insertLog({ actorId: null });
  });

  it.each(["login.success", "stock.transfer.create", "org.status.change"])(
    "accepts the action %s",
    async (action) => {
      await insertLog({ action });
    },
  );

  it.each(["login", "Stock.Transfer", "stock.", "stock transfer.create", ".x"])(
    "refuses the action %j: it must look like entity.action",
    async (action) => {
      expect(await constraintOf(insertLog({ action }))).toBe(
        "AuditLogs_action_check",
      );
    },
  );

  it("refuses an actor or organization that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await constraintOf(insertLog({ actorId: missing }))).toBe(
      "AuditLogs_actorId_fkey",
    );
    expect(await constraintOf(insertLog({ organizationId: missing }))).toBe(
      "AuditLogs_organizationId_fkey",
    );
  });

  describe("append-only trigger", () => {
    beforeEach(() => insertLog());

    it("refuses an UPDATE", async () => {
      await expect(
        getSequelize().query('UPDATE "AuditLogs" SET "action" = \'a.b\''),
      ).rejects.toThrow(/AuditLogs rows are append-only: UPDATE/);
    });

    it("refuses a DELETE", async () => {
      await expect(
        getSequelize().query('DELETE FROM "AuditLogs"'),
      ).rejects.toThrow(/AuditLogs rows are append-only: DELETE/);
    });

    it("still accepts new rows", async () => {
      await insertLog({ action: "login.success" });
      const [rows] = await getSequelize().query(
        'SELECT count(*)::int AS n FROM "AuditLogs"',
      );

      expect(rows[0].n).toBe(2);
    });
  });
});
