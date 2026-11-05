const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");

const insertEvent = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "WebhookEvents" ("provider", "eventId", "payload")
     VALUES (:provider, :eventId, CAST(:payload AS jsonb))`,
    {
      replacements: {
        provider: "xendit",
        eventId: "inv-1-PAID",
        payload: JSON.stringify({ status: "PAID" }),
        ...overrides,
      },
    },
  );

describe("WebhookEvents table", () => {
  beforeEach(() => clearTables(getSequelize()));
  afterAll(() => clearTables(getSequelize()));

  it("stores the payload and fills receivedAt, with processedAt empty", async () => {
    await insertEvent();
    const [rows] = await getSequelize().query('SELECT * FROM "WebhookEvents"');

    expect(rows[0].payload).toEqual({ status: "PAID" });
    expect(rows[0].receivedAt).toBeInstanceOf(Date);
    expect(rows[0].processedAt).toBeNull();
  });

  it("has no organizationId: it is a global table", async () => {
    await insertEvent();
    const [rows] = await getSequelize().query('SELECT * FROM "WebhookEvents"');

    expect(rows[0]).not.toHaveProperty("organizationId");
  });

  it("refuses the same event of the same provider twice", async () => {
    await insertEvent();
    expect(await constraintOf(insertEvent())).toBe(
      "WebhookEvents_provider_eventId_key",
    );
  });

  it("allows the same event id for another provider", async () => {
    await insertEvent();
    await insertEvent({ provider: "other" });
  });

  it("lets only one of two concurrent inserts of the same event win", async () => {
    const results = await Promise.allSettled([insertEvent(), insertEvent()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
