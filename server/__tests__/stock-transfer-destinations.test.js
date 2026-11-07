const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createWarehouse, assignWarehouse } = require("./support/factories");

jest.setTimeout(60000);

let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const as = (role, org = "A") => world.users[org][role].authorization;
const destinations = (role = "OWNER", query = "") =>
  request(app).get(`/api/stock/transfers/destinations${query}`).set("Authorization", as(role));

describe("GET /api/stock/transfers/destinations", () => {
  it("lists every active warehouse of the organization ordered by code, with only id, code and name", async () => {
    const organizationId = world.organizations.A;
    const c = await createWarehouse(organizationId, "CCC");
    const a = await createWarehouse(organizationId, "AAA");
    const b = await createWarehouse(organizationId, "BBB");

    const res = await destinations();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: a, code: "AAA", name: "AAA" },
        { id: b, code: "BBB", name: "BBB" },
        { id: c, code: "CCC", name: "CCC" },
      ],
    });
  });

  it("leaves out archived warehouses", async () => {
    const organizationId = world.organizations.A;
    const active = await createWarehouse(organizationId, "ACT");
    await createWarehouse(organizationId, "OLD", new Date());

    const res = await destinations();

    expect(res.body.items.map((item) => item.id)).toEqual([active]);
  });

  it("never shows a warehouse of another organization", async () => {
    await createWarehouse(world.organizations.A, "MINE");
    const foreign = await createWarehouse(world.organizations.B, "THEIRS");

    const res = await destinations();

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(foreign);
    expect(res.body.items.map((item) => item.code)).toEqual(["MINE"]);
  });

  it("gives a Warehouse Admin every active warehouse, not only the assigned ones (BL13)", async () => {
    const organizationId = world.organizations.A;
    const assigned = await createWarehouse(organizationId, "ASG");
    const other = await createWarehouse(organizationId, "OTH");
    await assignWarehouse(organizationId, world.users.A.WAREHOUSE_ADMIN.id, assigned);

    const res = await destinations("WAREHOUSE_ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.id).sort()).toEqual([assigned, other].sort());
  });

  it("answers an empty list when there is no active warehouse", async () => {
    const res = await destinations();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("answers 403 to a Viewer and 401 without a token", async () => {
    const viewer = await destinations("VIEWER");
    expect(viewer.status).toBe(403);
    expect(viewer.body.code).toBe("FORBIDDEN");

    const anonymous = await request(app).get("/api/stock/transfers/destinations");
    expect(anonymous.status).toBe(401);
  });

  it("is not taken for a transfer ID (the fixed path is declared before :id)", async () => {
    const res = await destinations();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
  });

  it("rejects any query parameter with 400", async () => {
    const res = await destinations("OWNER", "?includeArchived=true");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("sets no-store like the rest of /stock", async () => {
    const res = await destinations();
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });
});
