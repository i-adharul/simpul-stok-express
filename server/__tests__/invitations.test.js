const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { hashToken } = require("../helpers/token");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");
const { createOrganization, createWarehouse, giveRoomyPlan } = require("./support/factories");

jest.setTimeout(30000);

const DAY = 24 * 60 * 60 * 1000;
let orgA;
let orgB;
let users;
const as = (key) => `Bearer ${signToken(users[key].id)}`;
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const rows = () => sql('SELECT * FROM "Invitations" ORDER BY "createdAt"');
const invite = (body, key = "OWNER") =>
  request(app).post("/api/invitations").set("Authorization", as(key)).send(body);
const list = (query = "", key = "OWNER") => request(app).get(`/api/invitations${query}`).set("Authorization", as(key));
const cancel = (id, key = "OWNER") => request(app).delete(`/api/invitations/${id}`).set("Authorization", as(key));

// An invitation written directly, in any state. `createdAt` decides the order of the list.
async function seedInvitation({ organizationId = orgA, email, acceptedAt = null, expiresInDays = 7, createdAt = new Date() }) {
  const hash = hashToken(`seed-${email}-${Math.random()}`);
  const [row] = await sql(
    `INSERT INTO "Invitations" ("organizationId","email","role","tokenHash","expiresAt","acceptedAt","createdById","createdAt")
     VALUES (:organizationId,:email,'VIEWER',:hash, :expiresAt, :acceptedAt, :createdById, :createdAt) RETURNING *`,
    {
      organizationId,
      email,
      hash,
      expiresAt: new Date(createdAt.getTime() + expiresInDays * DAY),
      acceptedAt,
      createdById: organizationId === orgA ? users.OWNER.id : users.OWNER_B.id,
      createdAt,
    },
  );
  return row;
}

beforeEach(async () => {
  await clearTables(getSequelize());
  orgA = await createOrganization("tokoa");
  orgB = await createOrganization("tokob");
  await giveRoomyPlan(orgA, orgB);
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

describe("POST /api/invitations: success and the token", () => {
  it("answers 201 with the invitation and the raw token, never cached", async () => {
    const warehouseId = await createWarehouse(orgA, "GD-1");

    const res = await invite({ email: " Sari@Example.COM ", role: "WAREHOUSE_ADMIN", warehouseIds: [warehouseId] });

    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      invitation: {
        id: expect.any(String),
        email: "sari@example.com",
        role: "WAREHOUSE_ADMIN",
        warehouseIds: [warehouseId],
        expiresAt: expect.any(String),
        status: "PENDING",
      },
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/tokenHash/i);
  });

  it("stores only the hash of the token, and expires in 7 days created by the Owner", async () => {
    const before = Date.now();
    const { body } = await invite({ email: "sari@example.com", role: "VIEWER" });

    const [row] = await rows();
    expect(row.tokenHash).toBe(hashToken(body.token));
    expect(JSON.stringify(row)).not.toContain(body.token);
    expect(row).toMatchObject({ organizationId: orgA, email: "sari@example.com", role: "VIEWER", createdById: users.OWNER.id, acceptedAt: null });
    expect(row.warehouseIds).toEqual([]);
    const expires = new Date(row.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(expires).toBeLessThanOrEqual(Date.now() + 7 * DAY);
  });

  it("never shows the token or the hash in GET", async () => {
    const { body } = await invite({ email: "sari@example.com", role: "VIEWER" });

    const res = await list();

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(body.token);
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  it("gives every invitation its own token", async () => {
    const a = await invite({ email: "a@example.com", role: "VIEWER" });
    const b = await invite({ email: "b@example.com", role: "VIEWER" });

    expect(a.body.token).not.toBe(b.body.token);
  });
});

describe("POST /api/invitations: every 409", () => {
  const taken = (res) => {
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFLICT");
    expect(res.body.details).toEqual([expect.objectContaining({ source: "body", path: "email" })]);
  };

  it("an active user of the same organization", async () => {
    taken(await invite({ email: "viewer-a@example.com", role: "VIEWER" }));
  });

  it("the email in another case", async () => {
    taken(await invite({ email: "VIEWER-A@example.com", role: "VIEWER" }));
  });

  it("an active user of another organization", async () => {
    taken(await invite({ email: "owner-b@example.com", role: "VIEWER" }));
  });

  it("an inactive user of ANOTHER organization", async () => {
    await createAccount({ email: "gone-b@example.com", role: "VIEWER", organizationId: orgB, isActive: false });

    taken(await invite({ email: "gone-b@example.com", role: "VIEWER" }));
  });

  it("a platform admin's email", async () => {
    taken(await invite({ email: "platform@example.com", role: "VIEWER" }));
  });

  it("a pending invitation in the own organization", async () => {
    expect((await invite({ email: "sari@example.com", role: "VIEWER" })).status).toBe(201);

    taken(await invite({ email: "sari@example.com", role: "WAREHOUSE_ADMIN" }));
    expect(await rows()).toHaveLength(1);
  });

  it("a pending invitation of ANOTHER organization is not read: the invitation is still created (it clashes at acceptance)", async () => {
    await seedInvitation({ organizationId: orgB, email: "sari@example.com" });

    const res = await invite({ email: "sari@example.com", role: "VIEWER" });

    expect(res.status).toBe(201);
  });
});

describe("POST /api/invitations: what is allowed again", () => {
  it("an inactive member of the same organization may be invited again", async () => {
    await createAccount({ email: "gone-a@example.com", role: "VIEWER", organizationId: orgA, isActive: false });

    const res = await invite({ email: "gone-a@example.com", role: "WAREHOUSE_ADMIN" });

    expect(res.status).toBe(201);
  });

  it("an expired invitation does not block a new one", async () => {
    await seedInvitation({ email: "sari@example.com", createdAt: new Date(Date.now() - 10 * DAY), expiresInDays: 7 });

    const res = await invite({ email: "sari@example.com", role: "VIEWER" });

    expect(res.status).toBe(201);
  });

  it("an accepted invitation does not block a new one (the person left later)", async () => {
    await seedInvitation({ email: "sari@example.com", acceptedAt: new Date() });

    expect((await invite({ email: "sari@example.com", role: "VIEWER" })).status).toBe(201);
  });
});

describe("POST /api/invitations: validation and warehouses", () => {
  it("400 for the role OWNER, and nothing is stored", async () => {
    const res = await invite({ email: "sari@example.com", role: "OWNER" });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toEqual(["role"]);
    expect(await rows()).toHaveLength(0);
  });

  it("400 for unknown keys such as organizationId", async () => {
    const res = await invite({ email: "sari@example.com", role: "VIEWER", organizationId: orgB });

    expect(res.status).toBe(400);
  });

  it("404 for a warehouse of another organization, identical to a random UUID", async () => {
    const foreign = await createWarehouse(orgB, "GD-B");

    const a = await invite({ email: "a@example.com", role: "VIEWER", warehouseIds: [foreign] });
    const b = await invite({ email: "a@example.com", role: "VIEWER", warehouseIds: ["99999999-9999-4999-8999-999999999999"] });

    expect(a.status).toBe(404);
    expect(a.body).toEqual(b.body);
    expect(await rows()).toHaveLength(0);
  });

  it("404 for an archived warehouse, and for one good plus one foreign warehouse", async () => {
    const archived = await createWarehouse(orgA, "GD-OLD", new Date());
    const good = await createWarehouse(orgA, "GD-1");
    const foreign = await createWarehouse(orgB, "GD-B");

    expect((await invite({ email: "a@example.com", role: "VIEWER", warehouseIds: [archived] })).status).toBe(404);
    expect((await invite({ email: "a@example.com", role: "VIEWER", warehouseIds: [good, foreign] })).status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });

  it("a foreign warehouse is a 404 even when the email is taken (warehouses are checked first)", async () => {
    const foreign = await createWarehouse(orgB, "GD-B");

    const res = await invite({ email: "viewer-a@example.com", role: "VIEWER", warehouseIds: [foreign] });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/invitations", () => {
  it("lists Pending and Expired, not Accepted, newest first, with a derived status", async () => {
    const t = Date.now();
    await seedInvitation({ email: "old@example.com", createdAt: new Date(t - 10 * DAY) }); // expired
    await seedInvitation({ email: "used@example.com", acceptedAt: new Date(), createdAt: new Date(t - 3 * DAY) });
    await seedInvitation({ email: "new@example.com", createdAt: new Date(t - DAY) }); // pending
    await seedInvitation({ organizationId: orgB, email: "other@example.com" });

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i) => [i.email, i.status])).toEqual([
      ["new@example.com", "PENDING"],
      ["old@example.com", "EXPIRED"],
    ]);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(["email", "expiresAt", "id", "role", "status", "warehouseIds"]);
  });

  it("pages with a total", async () => {
    for (let i = 0; i < 3; i++) await seedInvitation({ email: `p${i}@example.com`, createdAt: new Date(Date.now() - i * 1000) });

    const res = await list("?page=2&pageSize=2");

    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(res.body.items).toHaveLength(1);
  });
});

describe("DELETE /api/invitations/:id", () => {
  it("cancels a pending invitation: 204 and the row is gone", async () => {
    const { body } = await invite({ email: "sari@example.com", role: "VIEWER" });

    const res = await cancel(body.invitation.id);

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
    expect((await list()).body.total).toBe(0);
  });

  it("cancels an expired invitation too", async () => {
    const row = await seedInvitation({ email: "old@example.com", createdAt: new Date(Date.now() - 10 * DAY) });

    expect((await cancel(row.id)).status).toBe(204);
  });

  it("an accepted invitation, an unknown, a malformed and a foreign ID give one identical 404", async () => {
    const accepted = await seedInvitation({ email: "used@example.com", acceptedAt: new Date() });
    const foreign = await seedInvitation({ organizationId: orgB, email: "other@example.com" });

    const answers = await Promise.all(
      [accepted.id, "99999999-9999-4999-8999-999999999999", "not-a-uuid", foreign.id].map((id) => cancel(id)),
    );

    for (const res of answers) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(answers[0].body);
    }
    expect(await rows()).toHaveLength(2);
  });
});

describe("the role matrix", () => {
  it.each(["WAREHOUSE_ADMIN", "VIEWER", "PLATFORM_ADMIN"])("answers a %s 403 on all three endpoints, before anything else", async (key) => {
    const row = await seedInvitation({ email: "x@example.com" });

    expect((await invite({ email: "bad", role: "OWNER" }, key)).status).toBe(403);
    expect((await list("?pageSize=999", key)).status).toBe(403);
    expect((await cancel(row.id, key)).status).toBe(403);
    expect((await cancel("not-a-uuid", key)).status).toBe(403);
    expect(await rows()).toHaveLength(1);
  });

  it("answers no token 401", async () => {
    expect((await request(app).post("/api/invitations").send({})).status).toBe(401);
    expect((await request(app).get("/api/invitations")).status).toBe(401);
    expect((await request(app).delete("/api/invitations/x")).status).toBe(401);
  });
});
