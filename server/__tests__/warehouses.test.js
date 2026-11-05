const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createWarehouse, assignWarehouse, createUser } = require("./support/factories");

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

const orgA = () => world.organizations.A;
const as = (role, org = "A") => world.users[org][role].authorization;
const get = (url, role = "OWNER") => request(app).get(url).set("Authorization", as(role));
const archivedWarehouse = (code, org = orgA()) => createWarehouse(org, code, new Date());
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];

describe("GET /api/warehouses", () => {
  it("lists the active warehouses of the Owner's organization, ordered by code, with the documented fields", async () => {
    await world.createWarehouse("A", "GD-B");
    await world.createWarehouse("A", "GD-A");
    await world.createWarehouse("B", "GD-X");
    await archivedWarehouse("GD-OLD");

    const res = await get("/api/warehouses");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.items.map((w) => w.code)).toEqual(["GD-A", "GD-B"]);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ["address", "archivedAt", "code", "createdAt", "id", "name", "organizationId", "updatedAt"],
    );
    expect(res.body.items[0].organizationId).toBe(orgA());
  });

  it("orders the list by code, whatever the order of creation", async () => {
    for (const code of ["C", "A", "B"]) await world.createWarehouse("A", code);

    const res = await get("/api/warehouses");

    expect(res.body.items.map((w) => w.code)).toEqual(["A", "B", "C"]);
  });

  it("shows archived warehouses to the Owner only when includeArchived=true", async () => {
    await world.createWarehouse("A", "GD-1");
    await archivedWarehouse("GD-OLD");

    const res = await get("/api/warehouses?includeArchived=true");

    expect(res.body.items.map((w) => w.code)).toEqual(["GD-1", "GD-OLD"]);
    expect(res.body.total).toBe(2);
    expect(res.body.items[1].archivedAt).not.toBeNull();
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("%s sees only the assigned active warehouses", async (role) => {
    const mine = await world.createWarehouse("A", "GD-MINE");
    await world.createWarehouse("A", "GD-OTHER");
    const oldOne = await archivedWarehouse("GD-OLD");
    await assignWarehouse(orgA(), world.users.A[role].id, mine);
    await assignWarehouse(orgA(), world.users.A[role].id, oldOne);

    const res = await get("/api/warehouses?includeArchived=true", role);

    expect(res.status).toBe(200);
    expect(res.body.items.map((w) => w.code)).toEqual(["GD-MINE"]);
    expect(res.body.total).toBe(1);
  });

  it("is empty for a Warehouse Admin without assignments", async () => {
    await world.createWarehouse("A");

    const res = await get("/api/warehouses", "WAREHOUSE_ADMIN");

    expect(res.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it("pages the list: page, pageSize and the total of all rows", async () => {
    for (const code of ["A", "B", "C", "D", "E"]) await world.createWarehouse("A", code);

    const second = await get("/api/warehouses?page=2&pageSize=2");
    const beyond = await get("/api/warehouses?page=9&pageSize=2");

    expect(second.body.items.map((w) => w.code)).toEqual(["C", "D"]);
    expect(second.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(beyond.body).toMatchObject({ items: [], total: 5 });
  });

  it.each([
    "page=0",
    "page=-2",
    "page=abc",
    "pageSize=0",
    "pageSize=101",
    "includeArchived=yes",
    "organizationId=00000000-0000-4000-8000-000000000000",
  ])("answers 400 VALIDATION_ERROR for ?%s", async (query) => {
    const res = await get(`/api/warehouses?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].source).toBe("query");
  });

  it("accepts pageSize 100", async () => {
    expect((await get("/api/warehouses?pageSize=100")).status).toBe(200);
  });
});

describe("GET /api/warehouses/:id", () => {
  it("returns the warehouse with its active assigned users, sorted by name, without email", async () => {
    const id = await world.createWarehouse("A", "GD-1");
    const zed = await createUser(orgA(), "zed@example.com", "VIEWER");
    const ana = await createUser(orgA(), "ana@example.com", "WAREHOUSE_ADMIN");
    const gone = await createUser(orgA(), "gone@example.com", "VIEWER");
    await sql(`UPDATE "Users" SET "name" = 'Zed' WHERE "id" = :zed`, { zed });
    await sql(`UPDATE "Users" SET "name" = 'Ana' WHERE "id" = :ana`, { ana });
    await sql(`UPDATE "Users" SET "isActive" = false WHERE "id" = :gone`, { gone });
    for (const userId of [zed, ana, gone]) await assignWarehouse(orgA(), userId, id);

    const res = await get(`/api/warehouses/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, code: "GD-1", archivedAt: null });
    expect(res.body.assignedUsers).toEqual([
      { id: ana, name: "Ana", role: "WAREHOUSE_ADMIN" },
      { id: zed, name: "Zed", role: "VIEWER" },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/@example\.com|email/);
  });

  it("has an empty assignedUsers list when nobody is assigned", async () => {
    const id = await world.createWarehouse("A");

    expect((await get(`/api/warehouses/${id}`)).body.assignedUsers).toEqual([]);
  });

  it("never shows a user of another organization, even when an assignment row points at one", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.B.VIEWER.id, id);
    await assignWarehouse(world.organizations.B, world.users.B.OWNER.id, id);

    const res = await get(`/api/warehouses/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.assignedUsers).toEqual([]);
    expect(res.text).not.toContain(world.users.B.VIEWER.id);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("lets a %s read an assigned warehouse", async (role) => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.A[role].id, id);

    const res = await get(`/api/warehouses/${id}`, role);

    expect(res.status).toBe(200);
    expect(res.body.assignedUsers.map((u) => u.id)).toEqual([world.users.A[role].id]);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s for a warehouse that is not assigned", async (role) => {
    const id = await world.createWarehouse("A");

    const res = await get(`/api/warehouses/${id}`, role);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("answers the same 404 for a missing ID, a malformed ID and another organization's warehouse", async () => {
    const foreign = await world.createWarehouse("B");

    const answers = [
      await get(`/api/warehouses/${foreign}`),
      await get("/api/warehouses/33333333-3333-4333-8333-333333333333"),
      await get("/api/warehouses/not-a-uuid"),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
    expect(answers[0].body.code).toBe("NOT_FOUND");
  });

  it("shows an archived warehouse to the Owner but answers 404 to everyone else", async () => {
    const id = await archivedWarehouse("GD-OLD");
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, id);

    expect((await get(`/api/warehouses/${id}`)).status).toBe(200);
    expect((await get(`/api/warehouses/${id}`, "WAREHOUSE_ADMIN")).status).toBe(404);
    expect((await get(`/api/warehouses/${id}`, "VIEWER")).status).toBe(404);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    const id = await world.createWarehouse("A");

    expect((await request(app).get(`/api/warehouses/${id}`)).status).toBe(401);
    const admin = await request(app).get(`/api/warehouses/${id}`).set("Authorization", world.platformAdmin.authorization);
    expect(admin.status).toBe(403);
  });
});

const send = (method, url, body, role = "OWNER") =>
  request(app)[method](url).set("Authorization", as(role)).send(body);
const warehouseRows = (organizationId) =>
  sql(`SELECT * FROM "Warehouses" WHERE "organizationId" = :organizationId ORDER BY "code"`, { organizationId });

describe("POST /api/warehouses", () => {
  it("creates a warehouse in the caller's organization and answers 201 with it", async () => {
    const res = await send("post", "/api/warehouses", { code: " gd-sudirman ", name: " Gudang Sudirman ", address: "Jl. Sudirman 1" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organizationId: orgA(),
      code: "GD-SUDIRMAN",
      name: "Gudang Sudirman",
      address: "Jl. Sudirman 1",
      archivedAt: null,
    });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await warehouseRows(orgA());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "GD-SUDIRMAN", name: "Gudang Sudirman" });
  });

  it("stores an empty address as null, and a missing address as null", async () => {
    const empty = await send("post", "/api/warehouses", { code: "A", name: "A", address: "  " });
    const missing = await send("post", "/api/warehouses", { code: "B", name: "B" });

    expect(empty.body.address).toBeNull();
    expect(missing.body.address).toBeNull();
  });

  it("answers 409 CONFLICT for a code that exists in the organization, whatever its letter case", async () => {
    await send("post", "/api/warehouses", { code: "GD-1", name: "Satu" });

    const res = await send("post", "/api/warehouses", { code: "gd-1 ", name: "Dua" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "CONFLICT", message: "Kode gudang sudah dipakai.", details: null });
    expect(await warehouseRows(orgA())).toHaveLength(1);
  });

  it("lets only one of two simultaneous requests for the same code win (the other gets 409)", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => send("post", "/api/warehouses", { code: "RACE", name: `Gudang ${n}` })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await warehouseRows(orgA())).toHaveLength(1);
  });

  it("allows the same code in another organization", async () => {
    await world.createWarehouse("B", "GD-1");

    const res = await send("post", "/api/warehouses", { code: "GD-1", name: "Satu" });

    expect(res.status).toBe(201);
  });

  it("rejects an unknown field, organizationId included, and creates nothing", async () => {
    const res = await send("post", "/api/warehouses", { code: "A", name: "A", organizationId: world.organizations.B });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ source: "body", path: "organizationId", message: "Field tidak dikenal." }]);
    expect(await warehouseRows(world.organizations.B)).toHaveLength(0);
    expect(await warehouseRows(orgA())).toHaveLength(0);
  });

  it.each([
    [{ name: "A" }, "code"],
    [{ code: "A".repeat(21), name: "A" }, "code"],
    [{ code: "A" }, "name"],
    [{ code: "A", name: "B".repeat(101) }, "name"],
    [{ code: "A", name: "B", address: "x".repeat(256) }, "address"],
  ])("answers 400 for %j", async (body, path) => {
    const res = await send("post", "/api/warehouses", body);

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toContain(path);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s before the body is read", async (role) => {
    const res = await send("post", "/api/warehouses", { nonsense: true }, role);

    expect(res.status).toBe(403);
    expect(await warehouseRows(orgA())).toHaveLength(0);
  });
});

describe("PATCH /api/warehouses/:id", () => {
  const readWarehouse = async (id) => (await sql(`SELECT * FROM "Warehouses" WHERE "id" = :id`, { id }))[0];

  it("updates code, name and address with the same rules as POST", async () => {
    const id = await world.createWarehouse("A", "GD-1");

    const res = await send("patch", `/api/warehouses/${id}`, { code: " gd-2 ", name: " Baru ", address: " Jl. Baru " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, code: "GD-2", name: "Baru", address: "Jl. Baru", organizationId: orgA() });
    expect(await readWarehouse(id)).toMatchObject({ code: "GD-2", name: "Baru", address: "Jl. Baru" });
  });

  it("changes only the fields that were sent, and clears the address with an empty string", async () => {
    const id = await world.createWarehouse("A", "GD-1");
    await sql(`UPDATE "Warehouses" SET "address" = 'Lama' WHERE "id" = :id`, { id });

    const renamed = await send("patch", `/api/warehouses/${id}`, { name: "Nama Baru" });
    expect(renamed.body).toMatchObject({ code: "GD-1", name: "Nama Baru", address: "Lama" });

    const cleared = await send("patch", `/api/warehouses/${id}`, { address: "" });
    expect(cleared.body).toMatchObject({ name: "Nama Baru", address: null });
  });

  it("answers 409 when the code belongs to another warehouse of the organization", async () => {
    await world.createWarehouse("A", "GD-1");
    const id = await world.createWarehouse("A", "GD-2");

    const res = await send("patch", `/api/warehouses/${id}`, { code: "gd-1" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "CONFLICT", message: "Kode gudang sudah dipakai.", details: null });
    expect((await readWarehouse(id)).code).toBe("GD-2");
  });

  it("accepts the warehouse's own code again and a code used in another organization", async () => {
    await world.createWarehouse("B", "GD-X");
    const id = await world.createWarehouse("A", "GD-1");

    expect((await send("patch", `/api/warehouses/${id}`, { code: "GD-1" })).status).toBe(200);
    expect((await send("patch", `/api/warehouses/${id}`, { code: "GD-X" })).status).toBe(200);
  });

  it("answers the same 404 for another organization's warehouse, a missing ID and a malformed ID, and changes nothing", async () => {
    const foreign = await world.createWarehouse("B", "GD-B");

    const answers = [
      await send("patch", `/api/warehouses/${foreign}`, { name: "Dibajak" }),
      await send("patch", "/api/warehouses/33333333-3333-4333-8333-333333333333", { name: "Dibajak" }),
      await send("patch", "/api/warehouses/not-a-uuid", { name: "Dibajak" }),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
    expect((await readWarehouse(foreign)).name).not.toBe("Dibajak");
  });

  it.each([
    [{}, "an empty body"],
    [{ organizationId: "x" }, "organizationId"],
    [{ archived: "yes" }, "archived that is not a boolean"],
    [{ name: "" }, "an empty name"],
    [{ code: "A".repeat(21) }, "a code that is too long"],
    [{ address: "x".repeat(256) }, "an address that is too long"],
  ])("answers 400 for %j (%s)", async (body) => {
    const id = await world.createWarehouse("A", "GD-1");

    const res = await send("patch", `/api/warehouses/${id}`, body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("does not move the warehouse to another organization", async () => {
    const id = await world.createWarehouse("A");

    await send("patch", `/api/warehouses/${id}`, { name: "X", organizationId: world.organizations.B });

    expect((await readWarehouse(id)).organizationId).toBe(orgA());
  });

  it("answers 404 for an archived warehouse unless it is being restored", async () => {
    const id = await archivedWarehouse("GD-OLD");

    expect((await send("patch", `/api/warehouses/${id}`, { name: "X" })).status).toBe(404);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s, also for another organization's ID", async (role) => {
    const own = await world.createWarehouse("A");
    const foreign = await world.createWarehouse("B");

    expect((await send("patch", `/api/warehouses/${own}`, { name: "X" }, role)).status).toBe(403);
    expect((await send("patch", `/api/warehouses/${foreign}`, { name: "X" }, role)).status).toBe(403);
    expect((await readWarehouse(own)).name).not.toBe("X");
  });
});

describe("PATCH /api/warehouses/:id with archived (BL08)", () => {
  const { createStockLevel } = require("./support/factories");
  const readWarehouse = async (id) => (await sql(`SELECT * FROM "Warehouses" WHERE "id" = :id`, { id }))[0];
  const codes = async (query = "") => (await get(`/api/warehouses${query}`)).body.items.map((w) => w.code);

  it("archives a warehouse whose stock rows are all 0 (or that has none)", async () => {
    const empty = await world.createWarehouse("A", "GD-EMPTY");
    const zero = await world.createWarehouse("A", "GD-ZERO");
    await createStockLevel(orgA(), zero, await world.createProduct("A"), 0);

    for (const id of [empty, zero]) {
      const res = await send("patch", `/api/warehouses/${id}`, { archived: true });

      expect(res.status).toBe(200);
      expect(res.body.archivedAt).not.toBeNull();
      expect((await readWarehouse(id)).archivedAt).not.toBeNull();
    }
    expect(await codes()).toEqual([]);
    expect(await codes("?includeArchived=true")).toEqual(["GD-EMPTY", "GD-ZERO"]);
  });

  it("refuses to archive while any stock row is above 0 (409) and changes nothing", async () => {
    const id = await world.createWarehouse("A", "GD-1");
    await createStockLevel(orgA(), id, await world.createProduct("A"), 0);
    await createStockLevel(orgA(), id, await world.createProduct("A"), 3);

    const res = await send("patch", `/api/warehouses/${id}`, { archived: true, name: "Dicoba" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "CONFLICT",
      message: "Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan.",
      details: null,
    });
    expect(await readWarehouse(id)).toMatchObject({ archivedAt: null });
    expect((await readWarehouse(id)).name).not.toBe("Dicoba");
  });

  it("looks only at the stock of this warehouse", async () => {
    const id = await world.createWarehouse("A", "GD-1");
    const other = await world.createWarehouse("A", "GD-2");
    await createStockLevel(orgA(), other, await world.createProduct("A"), 50);

    expect((await send("patch", `/api/warehouses/${id}`, { archived: true })).status).toBe(200);
  });

  it("restores an archived warehouse with archived: false", async () => {
    const id = await archivedWarehouse("GD-OLD");

    const res = await send("patch", `/api/warehouses/${id}`, { archived: false });

    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeNull();
    expect((await readWarehouse(id)).archivedAt).toBeNull();
    expect(await codes()).toEqual(["GD-OLD"]);
  });

  it("restores and edits in one request", async () => {
    const id = await archivedWarehouse("GD-OLD");

    const res = await send("patch", `/api/warehouses/${id}`, { archived: false, name: "Hidup Lagi" });

    expect(res.body).toMatchObject({ name: "Hidup Lagi", archivedAt: null });
  });

  it("finds an archived warehouse only when restoring: any other change is 404", async () => {
    const id = await archivedWarehouse("GD-OLD");

    expect((await send("patch", `/api/warehouses/${id}`, { name: "X" })).status).toBe(404);
    expect((await send("patch", `/api/warehouses/${id}`, { archived: true })).status).toBe(404);
    expect((await readWarehouse(id)).archivedAt).not.toBeNull();
  });

  it("treats archived: false on an active warehouse as no change (200)", async () => {
    const id = await world.createWarehouse("A");

    const res = await send("patch", `/api/warehouses/${id}`, { archived: false });

    expect(res.status).toBe(200);
    expect(res.body.archivedAt).toBeNull();
  });

  it("rejects a non-boolean archived (400)", async () => {
    const id = await world.createWarehouse("A");

    for (const archived of ["true", 1, null]) {
      expect((await send("patch", `/api/warehouses/${id}`, { archived })).status).toBe(400);
    }
  });

  it("answers 404 for another organization's warehouse, also when restoring", async () => {
    const foreign = await archivedWarehouse("GD-B", world.organizations.B);

    const res = await send("patch", `/api/warehouses/${foreign}`, { archived: false });

    expect(res.status).toBe(404);
    expect((await readWarehouse(foreign)).archivedAt).not.toBeNull();
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s", async (role) => {
    const id = await world.createWarehouse("A");

    expect((await send("patch", `/api/warehouses/${id}`, { archived: true }, role)).status).toBe(403);
    expect((await readWarehouse(id)).archivedAt).toBeNull();
  });

  it("removes the archived warehouse from the context of an assigned Warehouse Admin", async () => {
    const id = await world.createWarehouse("A");
    await assignWarehouse(orgA(), world.users.A.WAREHOUSE_ADMIN.id, id);
    expect((await get("/api/warehouses", "WAREHOUSE_ADMIN")).body.total).toBe(1);

    await send("patch", `/api/warehouses/${id}`, { archived: true });

    expect((await get("/api/warehouses", "WAREHOUSE_ADMIN")).body.total).toBe(0);
    expect((await get(`/api/warehouses/${id}`, "WAREHOUSE_ADMIN")).status).toBe(404);
  });
});
