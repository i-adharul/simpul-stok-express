const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const {
  createWorld,
  createOrganization,
  createPlan,
  createSubscription,
  createStockLevel,
} = require("./support/factories");

jest.setTimeout(60000);

// GET /api/platform/organizations (E11-03, BL25): the Platform admin sees every organization, no tenant
// role gets in, and no stock data leaves the server.
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const list = (authorization, query = "") => {
  const req = request(app).get(`/api/platform/organizations${query}`);
  return authorization ? req.set("Authorization", authorization) : req;
};
const asAdmin = (query) => list(world.platformAdmin.authorization, query);
const setStatus = (organizationId, status) =>
  getSequelize().query('UPDATE "Organizations" SET "status" = CAST(:status AS "enum_Organizations_status") WHERE "id" = :organizationId', {
    replacements: { status, organizationId },
  });

describe("the Platform admin", () => {
  it("gets 200 with every organization, with the fields of docs/04 and nothing else", async () => {
    const res = await asAdmin();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(["createdAt", "currentPeriodEnd", "id", "name", "plan", "slug", "status"]);
    }
    expect(res.body.items.map((item) => item.slug).sort()).toEqual(["tokoa", "tokob"]);
  });

  it("sees the plan name and the end of the period of each organization", async () => {
    const res = await asAdmin();

    expect(res.body.items[0].plan).toBe("Roomy");
    expect(res.body.items[0].currentPeriodEnd).toBe("2026-12-01T00:00:00.000Z");
  });

  it("lists an organization without a subscription, with plan and period end null", async () => {
    const bare = await createOrganization("tokobare");

    const res = await asAdmin();

    const item = res.body.items.find((entry) => entry.id === bare);
    expect(item).toMatchObject({ slug: "tokobare", plan: null, currentPeriodEnd: null });
  });

  it("sends TRIAL as TRIAL and lists trial, past due and suspended organizations next to active ones", async () => {
    await setStatus(world.organizations.A, "TRIAL");
    await setStatus(world.organizations.B, "SUSPENDED");
    const late = await createOrganization("tokolate");
    await createSubscription(late, await createPlan("Growth"));
    await setStatus(late, "PAST_DUE");
    const active = await createOrganization("tokoaktif");
    await setStatus(active, "ACTIVE");

    const res = await asAdmin();

    const byId = Object.fromEntries(res.body.items.map((item) => [item.id, item.status]));
    expect(byId).toEqual({
      [world.organizations.A]: "TRIAL",
      [world.organizations.B]: "SUSPENDED",
      [late]: "PAST_DUE",
      [active]: "ACTIVE",
    });
  });

  it("lists newest first", async () => {
    const newest = await createOrganization("tokobaru");

    const res = await asAdmin();

    expect(res.body.items[0].id).toBe(newest);
  });

  it("holds no stock data, whatever the organizations own", async () => {
    const warehouse = await world.createWarehouse("A", "GD-RAHASIA");
    const product = await world.createProduct("A", "SKU-RAHASIA");
    await createStockLevel(world.organizations.A, warehouse, product, 777);

    const res = await asAdmin();

    const text = JSON.stringify(res.body);
    for (const secret of ["GD-RAHASIA", "SKU-RAHASIA", "777", warehouse, product, "admin@example.com", "owner-a@example.com", "passwordHash"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/quantity|warehouse|product|stock|email|user/i);
  });
});

describe("paging", () => {
  beforeEach(async () => {
    for (const slug of ["toko1", "toko2", "toko3"]) await createOrganization(slug);
  });

  it("returns the window of page and pageSize with the total of all organizations", async () => {
    const first = await asAdmin("?page=1&pageSize=2");
    const second = await asAdmin("?page=2&pageSize=2");
    const third = await asAdmin("?page=3&pageSize=2");

    expect(first.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(2);
    expect(third.body.items).toHaveLength(1);
    const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("answers an empty page beyond the last one, with the total", async () => {
    const res = await asAdmin("?page=9&pageSize=20");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 5, page: 9 });
  });

  it("accepts pageSize 100", async () => {
    expect((await asAdmin("?pageSize=100")).body.pageSize).toBe(100);
  });

  it.each(["?pageSize=101", "?pageSize=0", "?page=0", "?page=abc", "?page=1.5", "?pageSize=", "?organizationId=x", "?includeArchived=true", "?status=ACTIVE"])(
    "answers 400 VALIDATION_ERROR for %s",
    async (query) => {
      const res = await asAdmin(query);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    },
  );
});

describe("everyone else is refused before any data is read", () => {
  let read;
  beforeEach(() => {
    read = jest.spyOn(db.Organization, "findAndCountAll");
  });
  afterEach(() => read.mockRestore());

  it("answers 401 UNAUTHENTICATED without a token, even with a bad query", async () => {
    for (const query of ["", "?pageSize=999"]) {
      const res = await list(undefined, query);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHENTICATED");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])("answers 403 FORBIDDEN to %s, even with a bad query", async (role) => {
    for (const query of ["", "?pageSize=999", "?organizationId=x"]) {
      const res = await list(world.users.A[role].authorization, query);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does read the database for the Platform admin (the spy is not blind)", async () => {
    await asAdmin();

    expect(read).toHaveBeenCalledTimes(1);
  });
});
