const express = require("express");
const request = require("supertest");
const db = require("../models");
const authentication = require("../middlewares/authentication");
const { errorHandler, notFoundHandler } = require("../middlewares/errorHandler");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, createWarehouse, assignWarehouse } = require("./support/factories");

jest.setTimeout(30000);

// One protected route that shows the context the middleware built.
const app = express();
app.get("/protected", authentication, (req, res) => res.json({ ctx: req.ctx }));
app.use(notFoundHandler);
app.use(errorHandler);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const getCtx = async (user) => {
  const res = await request(app).get("/protected").set("Authorization", `Bearer ${signToken(user.id)}`);
  expect(res.status).toBe(200);
  return res.body.ctx;
};

describe("req.ctx", () => {
  it("has exactly userId, organizationId, role and warehouseIds", async () => {
    const user = await createAccount({ role: "VIEWER" });

    const ctx = await getCtx(user);

    expect(Object.keys(ctx).sort()).toEqual(["organizationId", "role", "userId", "warehouseIds"]);
    expect(ctx).toMatchObject({
      userId: user.id,
      organizationId: user.organizationId,
      role: "VIEWER",
      warehouseIds: [],
    });
  });

  it("gives an Owner every active warehouse of the organization, and no archived or foreign one", async () => {
    const owner = await createAccount({ role: "OWNER" });
    const a = await createWarehouse(owner.organizationId, "GD-A");
    const b = await createWarehouse(owner.organizationId, "GD-B");
    await createWarehouse(owner.organizationId, "GD-OLD", new Date());
    const other = await createOrganization("tokolain");
    await createWarehouse(other, "GD-X");

    const ctx = await getCtx(owner);

    expect(ctx.warehouseIds.sort()).toEqual([a, b].sort());
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("gives a %s only the assigned active warehouses", async (role) => {
    const org = await createOrganization();
    const user = await createAccount({ role, organizationId: org });
    const mine = await createWarehouse(org, "GD-A");
    await createWarehouse(org, "GD-B");
    const archived = await createWarehouse(org, "GD-OLD", new Date());
    await assignWarehouse(org, user.id, mine);
    await assignWarehouse(org, user.id, archived);

    const ctx = await getCtx(user);

    expect(ctx.warehouseIds).toEqual([mine]);
  });

  it("gives a Platform admin no organization and no warehouses", async () => {
    const admin = await createAccount({ role: "PLATFORM_ADMIN", email: "admin@example.com" });

    const ctx = await getCtx(admin);

    expect(ctx).toEqual({ userId: admin.id, organizationId: null, role: "PLATFORM_ADMIN", warehouseIds: [] });
  });

  it("is not built for a request that fails authentication", async () => {
    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body.ctx).toBeUndefined();
  });
});
