const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const me = (token) => {
  const req = request(app).get("/api/me");
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
};

describe("GET /api/me", () => {
  it("returns the user and the organization of a tenant user", async () => {
    const user = await createAccount({ role: "WAREHOUSE_ADMIN", name: "Sari Admin" });

    const res = await me(signToken(user.id));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      user: { id: user.id, name: "Sari Admin", email: user.email, role: "WAREHOUSE_ADMIN" },
      organization: {
        id: user.organizationId,
        name: "Toko",
        slug: "tokomaju",
        status: expect.any(String),
      },
    });
  });

  it("returns organization null for a platform admin", async () => {
    const user = await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" });

    const res = await me(signToken(user.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: user.id, name: user.name, email: user.email, role: "PLATFORM_ADMIN" },
      organization: null,
    });
  });

  it("shows the current status of the organization on every call", async () => {
    const user = await createAccount();
    const token = signToken(user.id);
    await getSequelize().query(`UPDATE "Organizations" SET "status" = 'SUSPENDED'`);

    const res = await me(token);

    expect(res.body.organization.status).toBe("SUSPENDED");
  });

  it("returns nothing secret or internal", async () => {
    const user = await createAccount();

    const res = await me(signToken(user.id));

    expect(JSON.stringify(res.body)).not.toMatch(
      /passwordHash|resetToken|\$2[aby]\$|isActive|passwordChangedAt|lastLoginAt|organizationId/,
    );
  });
});

describe("POST /api/auth/logout", () => {
  it("answers 204 with no body and no token", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers 204 with a valid token", async () => {
    const user = await createAccount();

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${signToken(user.id)}`);

    expect(res.status).toBe(204);
  });

  it("answers 204 with a broken or expired token", async () => {
    const user = await createAccount();

    for (const token of ["garbage", signToken(user.id, "-1s")]) {
      const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(204);
    }
  });

  it("does not revoke the token on the server", async () => {
    const user = await createAccount();
    const token = signToken(user.id);

    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);

    expect((await me(token)).status).toBe(200);
  });
});
