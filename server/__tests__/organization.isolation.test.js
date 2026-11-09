const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

// GET and PATCH /api/organization have no ID in the URL, so the cross-tenant harness cannot attack
// them; this file is the proof that replaces it (see EXEMPT_ROUTES in support/exemptions.js).

let orgA;
let orgB;
let users;
const as = (role) => `Bearer ${signToken(users[role].id)}`;
const get = (auth) => {
  const req = request(app).get("/api/organization");
  return auth ? req.set("Authorization", auth) : req;
};
const patch = (auth, body) => {
  const req = request(app).patch("/api/organization").send(body);
  return auth ? req.set("Authorization", auth) : req;
};
const readOrg = async (id) =>
  (await getSequelize().query('SELECT * FROM "Organizations" WHERE "id" = :id', { replacements: { id } }))[0][0];

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  users = {
    OWNER: await createAccount({ email: "owner-a@example.com", role: "OWNER", organizationId: orgA }),
    WAREHOUSE_ADMIN: await createAccount({ email: "admin-a@example.com", role: "WAREHOUSE_ADMIN", organizationId: orgA }),
    VIEWER: await createAccount({ email: "viewer-a@example.com", role: "VIEWER", organizationId: orgA }),
    PLATFORM_ADMIN: await createAccount({ email: "platform@example.com", role: "PLATFORM_ADMIN" }),
    OWNER_B: await createAccount({ email: "owner-b@example.com", role: "OWNER", organizationId: orgB }),
  };
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("GET /api/organization", () => {
  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])("a %s reads their own organization", async (role) => {
    const res = await get(as(role));

    expect(res.status).toBe(200);
    expect(res.body.organization).toEqual({
      id: orgA,
      name: "Toko",
      slug: "tokoa",
      address: null,
      status: "TRIAL",
      createdAt: expect.any(String),
    });
  });

  it("never shows the other organization, whoever asks", async () => {
    const res = await get(as("OWNER_B"));

    expect(res.body.organization.id).toBe(orgB);
    expect(res.body.organization.slug).toBe("tokob");
  });

  it("answers a Platform admin 403 and no token 401", async () => {
    expect((await get(as("PLATFORM_ADMIN"))).status).toBe(403);
    const anonymous = await get();
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe("UNAUTHENTICATED");
  });
});

describe("PATCH /api/organization", () => {
  it("the Owner of A changes only A, even when the body carries the ID of B", async () => {
    const res = await patch(as("OWNER"), { name: "Toko A Baru", organizationId: orgB });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toContain("organizationId");
    expect((await readOrg(orgB)).name).toBe("Toko");
    expect((await readOrg(orgA)).name).toBe("Toko");
  });

  it("changes A and leaves B untouched", async () => {
    const res = await patch(as("OWNER"), { name: "Toko A Baru", address: "Jl. Merdeka 1" });

    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: orgA, name: "Toko A Baru", address: "Jl. Merdeka 1" });
    expect(await readOrg(orgA)).toMatchObject({ name: "Toko A Baru", address: "Jl. Merdeka 1" });
    expect(await readOrg(orgB)).toMatchObject({ name: "Toko", address: null });
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER", "PLATFORM_ADMIN"])("answers a %s 403, even for an invalid body", async (role) => {
    const valid = await patch(as(role), { name: "Diubah" });
    const invalid = await patch(as(role), { slug: "x" });

    expect(valid.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect(valid.body.code).toBe("FORBIDDEN");
    expect((await readOrg(orgA)).name).toBe("Toko");
  });

  it("answers no token 401", async () => {
    expect((await patch(undefined, { name: "Diubah" })).status).toBe(401);
  });

  it("uses the organization of the user in the database, not anything in the request", async () => {
    // An Owner moved to another organization is judged by the database row on the next request.
    await getSequelize().query('UPDATE "Users" SET "organizationId" = :orgB WHERE "id" = :id', {
      replacements: { orgB, id: users.OWNER.id },
    });

    const res = await patch(as("OWNER"), { name: "Dipindah" });

    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(orgB);
    expect((await readOrg(orgA)).name).toBe("Toko");
  });
});
