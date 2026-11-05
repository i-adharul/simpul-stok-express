const { getSequelize } = require("../support/db");
const { constraintOf } = require("../support/constraintOf");

const insertPlan = (overrides = {}) => {
  const plan = {
    name: "Test plan",
    priceIdr: 300000,
    maxWarehouses: 2,
    maxProducts: 100,
    maxMembers: 3,
    ...overrides,
  };
  return getSequelize().query(
    `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers")
     VALUES (:name, :priceIdr, :maxWarehouses, :maxProducts, :maxMembers)`,
    { replacements: plan },
  );
};

describe("Plans table", () => {
  beforeEach(async () => {
    await getSequelize().query('DELETE FROM "Plans"');
  });

  it("creates the id and timestamps in the database", async () => {
    await insertPlan();
    const [rows] = await getSequelize().query('SELECT * FROM "Plans"');

    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("refuses a negative price", async () => {
    expect(await constraintOf(insertPlan({ priceIdr: -1 }))).toBe(
      "Plans_priceIdr_check",
    );
  });

  it.each(["maxWarehouses", "maxProducts", "maxMembers"])(
    "refuses %s below 1",
    async (column) => {
      expect(await constraintOf(insertPlan({ [column]: 0 }))).toBe(
        `Plans_${column}_check`,
      );
    },
  );

  it("refuses two plans with the same name", async () => {
    await insertPlan();
    expect(await constraintOf(insertPlan())).toBe("Plans_name_key");
  });
});
