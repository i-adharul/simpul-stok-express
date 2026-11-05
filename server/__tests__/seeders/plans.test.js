const { getSequelize } = require("../support/db");
const { clearTables } = require("../support/clearTables");
const seeder = require("../../seeders/20261105000100-plans");

const plans = async () => {
  const [rows] = await getSequelize().query(
    'SELECT "name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers" FROM "Plans" ORDER BY "priceIdr"',
  );
  return rows;
};

describe("plans seeder", () => {
  beforeEach(() => clearTables(getSequelize()));
  afterAll(() => clearTables(getSequelize()));

  it("creates Starter and Business with the documented prices and limits", async () => {
    await seeder.up(getSequelize().getQueryInterface());

    expect(await plans()).toEqual([
      {
        name: "Starter",
        priceIdr: 300000,
        maxWarehouses: 2,
        maxProducts: 100,
        maxMembers: 3,
      },
      {
        name: "Business",
        priceIdr: 700000,
        maxWarehouses: 10,
        maxProducts: 500,
        maxMembers: 10,
      },
    ]);
  });

  it("can run twice without duplicating or changing a plan", async () => {
    const queryInterface = getSequelize().getQueryInterface();
    await seeder.up(queryInterface);
    await getSequelize().query(
      'UPDATE "Plans" SET "priceIdr" = 1 WHERE "name" = \'Starter\'',
    );
    await seeder.up(queryInterface);

    const rows = await plans();
    expect(rows).toHaveLength(2);
    expect(rows[0].priceIdr).toBe(1);
  });

  it("removes only its own plans on down", async () => {
    const queryInterface = getSequelize().getQueryInterface();
    await getSequelize().query(
      `INSERT INTO "Plans" ("name", "priceIdr", "maxWarehouses", "maxProducts", "maxMembers") VALUES ('Custom', 1, 1, 1, 1)`,
    );
    await seeder.up(queryInterface);
    await seeder.down(queryInterface);

    expect((await plans()).map((plan) => plan.name)).toEqual(["Custom"]);
  });

  it("is found by sequelize-cli in the seeders folder", () => {
    const files = require("fs").readdirSync(
      require("path").join(__dirname, "..", "..", "seeders"),
    );

    expect(files).toContain("20261105000100-plans.js");
  });
});
