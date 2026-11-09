const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { requirePlatformAdmin } = require("../middlewares/authorization");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");

jest.setTimeout(30000);

describe("requirePlatformAdmin (unit)", () => {
  const run = (ctx) => {
    const next = jest.fn();
    requirePlatformAdmin({ ctx }, {}, next);
    return next;
  };

  it("lets a Platform admin through", () => {
    expect(run({ role: "PLATFORM_ADMIN" })).toHaveBeenCalledWith();
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER", "UNKNOWN"])("answers 403 FORBIDDEN to %s", (role) => {
    expect(run({ role }).mock.calls[0][0]).toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("is a bug, not a 403, to run before authentication", () => {
    expect(() => requirePlatformAdmin({}, {}, jest.fn())).toThrow(/needs req.ctx/);
  });
});

describe("/api/platform/* guard on the real app", () => {
  beforeEach(() => clearTables(getSequelize()));
  afterAll(async () => {
    await clearTables(getSequelize());
    await db.sequelize.close();
  });

  const get = (token) => {
    const req = request(app).get("/api/platform/organizations");
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  it("answers 401 without a token", async () => {
    const res = await get();

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to %s", async (role) => {
    const user = await createAccount({ role });

    const res = await get(signToken(user.id));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("lets a Platform admin past the guard (404 only because there is no endpoint yet)", async () => {
    const user = await createAccount({ role: "PLATFORM_ADMIN", email: "platform@example.com" });

    const res = await get(signToken(user.id));

    expect(res.status).toBe(404);
  });
});
