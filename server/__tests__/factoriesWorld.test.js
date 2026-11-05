const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const rows = async (sql) => (await getSequelize().query(sql))[0];

describe("createWorld", () => {
  it("builds two different organizations", async () => {
    const world = await createWorld();

    expect(world.organizations.A).toBeTruthy();
    expect(world.organizations.B).toBeTruthy();
    expect(world.organizations.A).not.toBe(world.organizations.B);
  });

  it("builds one user per role in each organization, and a Platform admin without one", async () => {
    const world = await createWorld();

    for (const key of ["A", "B"]) {
      for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]) {
        expect(world.users[key][role]).toMatchObject({ role, organizationId: world.organizations[key] });
      }
    }
    expect(world.platformAdmin).toMatchObject({ role: "PLATFORM_ADMIN", organizationId: null });
    expect(await rows('SELECT 1 FROM "Users"')).toHaveLength(7);
  });

  it("gives every user a token that the real app accepts", async () => {
    const world = await createWorld();

    const res = await request(app).get("/api/me").set("Authorization", world.users.B.VIEWER.authorization);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("VIEWER");
    expect(res.body.organization.id).toBe(world.organizations.B);
  });

  it("builds warehouses and products in the organization asked for, with unique codes", async () => {
    const world = await createWorld();

    const wa = await world.createWarehouse("A");
    const wb = await world.createWarehouse("B");
    await world.createWarehouse("A");
    const pa = await world.createProduct("A");
    await world.createProduct("B", "SKU-FIXED");

    const warehouses = await rows('SELECT "id","organizationId" FROM "Warehouses"');
    expect(warehouses).toHaveLength(3);
    expect(warehouses.find((w) => w.id === wa).organizationId).toBe(world.organizations.A);
    expect(warehouses.find((w) => w.id === wb).organizationId).toBe(world.organizations.B);
    const products = await rows('SELECT "id","organizationId","sku" FROM "Products"');
    expect(products.find((p) => p.id === pa).organizationId).toBe(world.organizations.A);
    expect(products.find((p) => p.sku === "SKU-FIXED").organizationId).toBe(world.organizations.B);
  });
});
