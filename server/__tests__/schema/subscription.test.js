const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");

let organizationId;
let planId;

const insertSubscription = (overrides = {}) =>
  getSequelize().query(
    `INSERT INTO "Subscriptions" ("organizationId", "planId", "billingDay",
                                  "currentPeriodStart", "currentPeriodEnd", "graceUntil")
     VALUES (:organizationId, :planId, :billingDay,
             '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '2026-12-04T00:00:00Z')`,
    {
      replacements: { organizationId, planId, billingDay: null, ...overrides },
    },
  );

const insertOrganization = async (slug) => {
  const [rows] = await getSequelize().query(
    `INSERT INTO "Organizations" ("name", "slug") VALUES ('Toko', :slug) RETURNING "id"`,
    { replacements: { slug } },
  );
  return rows[0].id;
};

const clear = async () => {
  const sequelize = getSequelize();
  await sequelize.query('DELETE FROM "Subscriptions"');
  await sequelize.query('DELETE FROM "Users"');
  await sequelize.query('DELETE FROM "Organizations"');
  await sequelize.query('DELETE FROM "Plans"');
};

describe("Subscriptions table", () => {
  beforeEach(async () => {
    await clear();
    organizationId = await insertOrganization("tokomaju");
    const [rows] = await getSequelize().query(
      `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers")
       VALUES ('Starter', 300000, 2, 100, 3) RETURNING "id"`,
    );
    planId = rows[0].id;
  });

  // Leave the tables empty: other test files delete from them and would hit foreign keys.
  afterAll(clear);

  it("accepts a trial subscription with an empty billingDay", async () => {
    await insertSubscription();
    const [rows] = await getSequelize().query('SELECT * FROM "Subscriptions"');

    expect(rows[0].billingDay).toBeNull();
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([1, 31])("accepts billingDay %i", async (billingDay) => {
    await insertSubscription({ billingDay });
  });

  it.each([0, 32])("refuses billingDay %i", async (billingDay) => {
    expect(await constraintOf(insertSubscription({ billingDay }))).toBe(
      "Subscriptions_billingDay_check",
    );
  });

  it("allows only one subscription per organization", async () => {
    await insertSubscription();
    expect(await constraintOf(insertSubscription())).toBe(
      "Subscriptions_organizationId_key",
    );
  });

  it("refuses a plan that does not exist", async () => {
    expect(
      await constraintOf(
        insertSubscription({ planId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("Subscriptions_planId_fkey");
  });

  it("refuses to delete a plan that is in use", async () => {
    await insertSubscription();
    expect(
      await constraintOf(getSequelize().query('DELETE FROM "Plans"')),
    ).toBe("Subscriptions_planId_fkey");
  });

  it("refuses a period that ends before it starts", async () => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Subscriptions" ("organizationId", "planId", "currentPeriodStart", "currentPeriodEnd", "graceUntil")
           VALUES (:organizationId, :planId, '2026-12-01T00:00:00Z', '2026-11-01T00:00:00Z', '2026-12-04T00:00:00Z')`,
          { replacements: { organizationId, planId } },
        ),
      ),
    ).toBe("Subscriptions_period_check");
  });

  it("refuses a grace period that ends before the period", async () => {
    expect(
      await constraintOf(
        getSequelize().query(
          `INSERT INTO "Subscriptions" ("organizationId", "planId", "currentPeriodStart", "currentPeriodEnd", "graceUntil")
           VALUES (:organizationId, :planId, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '2026-11-15T00:00:00Z')`,
          { replacements: { organizationId, planId } },
        ),
      ),
    ).toBe("Subscriptions_grace_check");
  });
});
