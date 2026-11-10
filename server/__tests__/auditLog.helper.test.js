const db = require("../models");
const { writeAuditLog } = require("../helpers/auditLog");
const { inTransaction } = require("../helpers/transaction");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization, createUser } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const allRows = async () => (await getSequelize().query('SELECT * FROM "AuditLogs"'))[0];
const ENTITY_ID = "44444444-4444-4444-8444-444444444444";

async function setup() {
  const target = await createOrganization("target");
  const other = await createOrganization("other");
  const actorId = await createUser(other, "admin@example.com", "OWNER");
  return { target, other, actorId };
}

describe("writeAuditLog", () => {
  it("writes a row for the target organization with every given field", async () => {
    const { target, actorId } = await setup();

    await writeAuditLog({
      organizationId: target,
      actorId,
      action: "organization.status.update",
      entityType: "Organization",
      entityId: target,
      metadata: { from: "ACTIVE", to: "SUSPENDED", reason: "Unpaid" },
    });

    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: target,
      actorId,
      action: "organization.status.update",
      entityType: "Organization",
      entityId: target,
      metadata: { from: "ACTIVE", to: "SUSPENDED", reason: "Unpaid" },
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("belongs to the target organization, not to the organization of the actor", async () => {
    const { target, other, actorId } = await setup();

    await writeAuditLog({ organizationId: target, actorId, action: "organization.status.update", entityType: "Organization" });

    const rows = await allRows();
    expect(rows.map((row) => row.organizationId)).toEqual([target]);
    expect(rows.some((row) => row.organizationId === other)).toBe(false);
  });

  it("defaults metadata to {} and leaves actor and entity empty when they are not given", async () => {
    const { target } = await setup();

    await writeAuditLog({ organizationId: target, action: "system.cycle.run", entityType: "Organization" });

    const [row] = await allRows();
    expect(row.metadata).toEqual({});
    expect(row.actorId).toBeNull();
    expect(row.entityId).toBeNull();
  });

  it("returns the created row", async () => {
    const { target } = await setup();

    const created = await writeAuditLog({ organizationId: target, action: "stock.adjust.create", entityType: "StockLevel", entityId: ENTITY_ID });

    expect(created.id).toEqual(expect.any(String));
    expect(created.organizationId).toBe(target);
  });
});

describe("writeAuditLog: action format", () => {
  it.each(["login", "Stock.Transfer", "stock.", ".x", "stock transfer.create", "stock.transfer_create", "stock.transfer2", "", null, undefined, 42])(
    "rejects %j before anything is written",
    async (action) => {
      const { target } = await setup();

      await expect(writeAuditLog({ organizationId: target, action, entityType: "StockTransfer" })).rejects.toThrow(/entity\.action/);

      expect(await allRows()).toEqual([]);
    },
  );

  it("rejects an action of 101 characters", async () => {
    const { target } = await setup();
    const tooLong = `${"a".repeat(99)}.b`;

    await expect(writeAuditLog({ organizationId: target, action: tooLong, entityType: "X" })).rejects.toThrow(/entity\.action/);
    expect(await allRows()).toEqual([]);
  });

  it("accepts an action of exactly 100 characters", async () => {
    const { target } = await setup();
    const longest = `${"a".repeat(98)}.b`;

    await writeAuditLog({ organizationId: target, action: longest, entityType: "X" });

    expect((await allRows())[0].action).toBe(longest);
  });

  it.each(["login.success", "stock.transfer.create", "organization.status.update"])("accepts %s", async (action) => {
    const { target } = await setup();

    await writeAuditLog({ organizationId: target, action, entityType: "X" });

    expect((await allRows())[0].action).toBe(action);
  });

  it.each([null, "text", ["a"], 5])("rejects metadata %j that is not a plain object", async (metadata) => {
    const { target } = await setup();

    await expect(writeAuditLog({ organizationId: target, action: "a.b", entityType: "X", metadata })).rejects.toThrow(/plain object/);
    expect(await allRows()).toEqual([]);
  });

  it("refuses a missing organization (the row always belongs to one)", async () => {
    await expect(writeAuditLog({ action: "a.b", entityType: "X" })).rejects.toThrow(/organizationId/);
  });
});

describe("writeAuditLog: transaction", () => {
  it("is removed by a rollback of the change it describes", async () => {
    const { target } = await setup();

    await expect(
      inTransaction(async (transaction) => {
        await writeAuditLog({ organizationId: target, action: "organization.status.update", entityType: "Organization" }, { transaction });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");

    expect(await allRows()).toEqual([]);
  });

  it("stays when the transaction commits", async () => {
    const { target } = await setup();

    await inTransaction((transaction) =>
      writeAuditLog({ organizationId: target, action: "organization.status.update", entityType: "Organization" }, { transaction }),
    );

    expect(await allRows()).toHaveLength(1);
  });

  it("is not visible outside the transaction before it commits", async () => {
    const { target } = await setup();

    await inTransaction(async (transaction) => {
      await writeAuditLog({ organizationId: target, action: "a.b", entityType: "X" }, { transaction });

      expect(await allRows()).toEqual([]);
    });
  });
});

describe("AuditLog is append-only (trigger from E0-06)", () => {
  async function oneRow() {
    const { target } = await setup();
    const created = await writeAuditLog({ organizationId: target, action: "a.b", entityType: "X" });
    return created.id;
  }

  it("rejects an UPDATE through SQL", async () => {
    const id = await oneRow();

    await expect(getSequelize().query('UPDATE "AuditLogs" SET "action" = \'c.d\' WHERE "id" = :id', { replacements: { id } })).rejects.toThrow(
      /append-only: UPDATE/,
    );
  });

  it("rejects a DELETE through SQL", async () => {
    const id = await oneRow();

    await expect(getSequelize().query('DELETE FROM "AuditLogs" WHERE "id" = :id', { replacements: { id } })).rejects.toThrow(/append-only: DELETE/);
  });

  it("rejects an UPDATE and a DELETE through the model", async () => {
    const id = await oneRow();

    await expect(db.AuditLog.update({ action: "c.d" }, { where: { id } })).rejects.toThrow(/append-only/);
    await expect(db.AuditLog.destroy({ where: { id } })).rejects.toThrow(/append-only/);
    expect(await allRows()).toHaveLength(1);
  });

  it("the helper exposes no update or delete", () => {
    expect(Object.keys(require("../helpers/auditLog")).sort()).toEqual(["ACTION_FORMAT", "writeAuditLog"]);
  });
});
