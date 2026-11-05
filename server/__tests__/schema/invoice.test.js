const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");
const { clearTables } = require("../support/clearTables");
const {
  createOrganization,
  createPlan,
  createSubscription,
} = require("../support/factories");

let organizationId;
let planId;
let subscriptionId;
let counter;

const insertInvoice = (overrides = {}) => {
  counter += 1;
  return getSequelize().query(
    `INSERT INTO "Invoices"
       ("organizationId", "subscriptionId", "planId", "number", "amountIdr", "kind", "status",
        "periodStart", "periodEnd", "externalId", "dueAt", "expiresAt", "paidAt")
     VALUES (:organizationId, :subscriptionId, :planId, :number, :amountIdr,
             CAST(:kind AS "enum_Invoices_kind"), CAST(:status AS "enum_Invoices_status"),
             :periodStart, :periodEnd, :externalId, '2026-11-08T00:00:00Z', '2026-11-08T00:00:00Z', :paidAt)`,
    {
      replacements: {
        organizationId,
        subscriptionId,
        planId,
        number: `INV-2026-${String(counter).padStart(4, "0")}`,
        amountIdr: 300000,
        kind: "INITIAL",
        status: "PENDING",
        periodStart: null,
        periodEnd: null,
        externalId: null,
        paidAt: null,
        ...overrides,
      },
    },
  );
};

describe("Invoices table", () => {
  beforeEach(async () => {
    counter = 0;
    await clearTables(getSequelize());
    organizationId = await createOrganization();
    planId = await createPlan();
    subscriptionId = await createSubscription(organizationId, planId);
  });

  afterAll(() => clearTables(getSequelize()));

  it("fills the defaults: a new invoice is PENDING and has no payment data", async () => {
    await getSequelize().query(
      `INSERT INTO "Invoices" ("organizationId", "subscriptionId", "planId", "number", "amountIdr", "kind", "dueAt", "expiresAt")
       VALUES (:organizationId, :subscriptionId, :planId, 'INV-2026-0001', 300000, 'INITIAL', now(), now())`,
      { replacements: { organizationId, subscriptionId, planId } },
    );
    const [rows] = await getSequelize().query('SELECT * FROM "Invoices"');

    expect(rows[0].status).toBe("PENDING");
    expect(rows[0].externalId).toBeNull();
    expect(rows[0].paymentUrl).toBeNull();
    expect(rows[0].paidAt).toBeNull();
  });

  it.each(["INITIAL", "PLAN_CHANGE", "RENEWAL"])(
    "accepts the kind %s",
    async (kind) => {
      await insertInvoice({ kind });
    },
  );

  it("refuses a kind or status outside the enum", async () => {
    await expect(insertInvoice({ kind: "EXTRA" })).rejects.toThrow(
      /invalid input value for enum/,
    );
    await expect(insertInvoice({ status: "CANCELLED" })).rejects.toThrow(
      /invalid input value for enum/,
    );
  });

  it("refuses the same invoice number twice in one organization, not across organizations", async () => {
    await insertInvoice({ number: "INV-2026-0001" });
    expect(await constraintOf(insertInvoice({ number: "INV-2026-0001" }))).toBe(
      "Invoices_organizationId_number_key",
    );
    const other = await createOrganization("lain");
    const otherSubscription = await createSubscription(other, planId);
    await insertInvoice({
      organizationId: other,
      subscriptionId: otherSubscription,
      number: "INV-2026-0001",
    });
  });

  it("allows several invoices without an externalId but refuses a repeated one", async () => {
    await insertInvoice();
    await insertInvoice();
    await insertInvoice({ externalId: "xnd-1" });
    expect(await constraintOf(insertInvoice({ externalId: "xnd-1" }))).toBe(
      "Invoices_externalId_key",
    );
  });

  it("refuses an amount of 0 or less", async () => {
    expect(await constraintOf(insertInvoice({ amountIdr: 0 }))).toBe(
      "Invoices_amountIdr_check",
    );
  });

  it("requires the period dates together and in order", async () => {
    expect(
      await constraintOf(
        insertInvoice({ periodStart: "2026-11-01T00:00:00Z" }),
      ),
    ).toBe("Invoices_period_check");
    expect(
      await constraintOf(
        insertInvoice({
          periodStart: "2026-12-01T00:00:00Z",
          periodEnd: "2026-11-01T00:00:00Z",
        }),
      ),
    ).toBe("Invoices_period_check");
    await insertInvoice({
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-12-01T00:00:00Z",
    });
  });

  it("refuses an invoice that expires before it is due", async () => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Invoices" ("organizationId", "subscriptionId", "planId", "number", "amountIdr", "kind", "dueAt", "expiresAt")
           VALUES (:organizationId, :subscriptionId, :planId, 'INV-X', 1, 'RENEWAL', '2026-11-10T00:00:00Z', '2026-11-09T00:00:00Z')`,
          { replacements: { organizationId, subscriptionId, planId } },
        ),
      ),
    ).toBe("Invoices_expiresAt_check");
  });

  it("has paidAt exactly when the status is PAID", async () => {
    expect(await constraintOf(insertInvoice({ status: "PAID" }))).toBe(
      "Invoices_paidAt_check",
    );
    expect(
      await constraintOf(insertInvoice({ paidAt: "2026-11-02T00:00:00Z" })),
    ).toBe("Invoices_paidAt_check");
    await insertInvoice({ status: "PAID", paidAt: "2026-11-02T00:00:00Z" });
  });

  it("refuses a subscription or plan that does not exist, and deleting one in use", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await constraintOf(insertInvoice({ subscriptionId: missing }))).toBe(
      "Invoices_subscriptionId_fkey",
    );
    expect(await constraintOf(insertInvoice({ planId: missing }))).toBe(
      "Invoices_planId_fkey",
    );
    await insertInvoice();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Subscriptions"')),
    ).toBe("Invoices_subscriptionId_fkey");
  });
});
