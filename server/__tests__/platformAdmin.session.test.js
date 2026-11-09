const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { createAccount } = require("./support/accounts");

jest.setTimeout(60000);

// BL25: a Platform admin signs in like anyone else, has no organization, and from that session
// there is no way to stock data or any other tenant data.
let world;
let token;
let user;
beforeAll(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
  user = await createAccount({ email: "platform2@example.com", role: "PLATFORM_ADMIN" });
  const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
  token = login.body.token;
  world.loginBody = login.body;
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const as = (method, path) => request(app)[method](path).set("Authorization", `Bearer ${token}`).send({});

describe("a Platform admin session", () => {
  it("login gives the platform redirect and a role without an organization", () => {
    // The API contract (docs/04) says "/platform"; the client turns it into the S19 page (E11-01 step 5).
    expect(world.loginBody.redirectTo).toBe("/platform");
    expect(world.loginBody.user.role).toBe("PLATFORM_ADMIN");
    expect(world.loginBody.user).not.toHaveProperty("organizationId");
  });

  it("GET /api/me returns organization: null", async () => {
    const res = await as("get", "/api/me");

    expect(res.status).toBe(200);
    expect(res.body.organization).toBeNull();
    expect(res.body.user.role).toBe("PLATFORM_ADMIN");
  });

  it.each([
    ["get", "/api/stock"],
    ["get", "/api/stock/movements"],
    ["get", "/api/stock/transfers/destinations"],
    ["post", "/api/stock/receive"],
    ["post", "/api/stock/adjust"],
    ["post", "/api/stock/transfers"],
    ["get", "/api/dashboard"],
    ["get", "/api/warehouses"],
    ["get", "/api/products"],
    ["get", "/api/members"],
    ["get", "/api/invitations"],
    ["post", "/api/invitations"],
    ["get", "/api/organization"],
    ["patch", "/api/organization"],
  ])("%s %s answers 403 FORBIDDEN", async (method, path) => {
    const res = await as(method, path);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("is not given another organization's data by guessing its ID either (403, same as a random ID)", async () => {
    const foreign = await as("get", `/api/warehouses/${await world.createWarehouse("A")}`);
    const random = await as("get", "/api/warehouses/00000000-0000-4000-8000-000000000000");

    expect(foreign.status).toBe(403);
    expect(random.status).toBe(403);
    expect(foreign.body).toEqual(random.body);
  });
});
