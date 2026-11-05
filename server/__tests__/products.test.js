const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld, createProduct } = require("./support/factories");

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
const as = (role) => world.users.A[role].authorization;
const get = (url, role = "OWNER") => request(app).get(url).set("Authorization", as(role));
const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const archivedProduct = async (sku, org = orgA()) => {
  const id = await createProduct(org, sku);
  await sql(`UPDATE "Products" SET "archivedAt" = now() WHERE "id" = :id`, { id });
  return id;
};

describe("GET /api/products", () => {
  it("lists the active products of the organization ordered by SKU, with the documented fields", async () => {
    await world.createProduct("A", "SKU-B");
    await world.createProduct("A", "SKU-A");
    await world.createProduct("B", "SKU-X");
    await archivedProduct("SKU-OLD");

    const res = await get("/api/products");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.items.map((p) => p.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(Object.keys(res.body.items[0]).sort()).toEqual(
      ["archivedAt", "createdAt", "id", "minStock", "name", "organizationId", "sku", "unit", "updatedAt"],
    );
    expect(res.body.items[0]).toMatchObject({ organizationId: orgA(), unit: "pcs", minStock: 0 });
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("shows every active product to a %s (products are not tied to warehouses)", async (role) => {
    await world.createProduct("A", "SKU-1");
    await world.createProduct("A", "SKU-2");

    const res = await get("/api/products", role);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });

  it("shows archived products to the Owner only, and only with includeArchived=true", async () => {
    await world.createProduct("A", "SKU-1");
    await archivedProduct("SKU-OLD");

    const owner = await get("/api/products?includeArchived=true");
    const ownerDefault = await get("/api/products");
    const admin = await get("/api/products?includeArchived=true", "WAREHOUSE_ADMIN");

    expect(owner.body.items.map((p) => p.sku)).toEqual(["SKU-1", "SKU-OLD"]);
    expect(owner.body.total).toBe(2);
    expect(ownerDefault.body.items.map((p) => p.sku)).toEqual(["SKU-1"]);
    expect(admin.body.items.map((p) => p.sku)).toEqual(["SKU-1"]);
  });

  it("pages the list with a total of all rows", async () => {
    for (const sku of ["A", "B", "C", "D", "E"]) await world.createProduct("A", sku);

    const second = await get("/api/products?page=2&pageSize=2");

    expect(second.body.items.map((p) => p.sku)).toEqual(["C", "D"]);
    expect(second.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect((await get("/api/products?page=9&pageSize=2")).body.items).toEqual([]);
  });

  it.each([
    "page=0",
    "page=abc",
    "pageSize=0",
    "pageSize=101",
    "includeArchived=1",
    "search=teh",
    "organizationId=00000000-0000-4000-8000-000000000000",
  ])("answers 400 VALIDATION_ERROR for ?%s (the contract has no search parameter)", async (query) => {
    const res = await get(`/api/products?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/products/:id", () => {
  it.each(["OWNER", "WAREHOUSE_ADMIN", "VIEWER"])("returns the product to a %s", async (role) => {
    const id = await world.createProduct("A", "SKU-1");

    const res = await get(`/api/products/${id}`, role);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, sku: "SKU-1", organizationId: orgA() });
  });

  it("answers the same 404 for a malformed ID, a missing ID and another organization's product", async () => {
    const foreign = await world.createProduct("B");

    const answers = [
      await get(`/api/products/${foreign}`),
      await get("/api/products/33333333-3333-4333-8333-333333333333"),
      await get("/api/products/not-a-uuid"),
    ];

    for (const res of answers) expect(res.status).toBe(404);
    expect(new Set(answers.map((r) => r.text)).size).toBe(1);
  });

  it("shows an archived product to the Owner only (404 for the others)", async () => {
    const id = await archivedProduct("SKU-OLD");

    expect((await get(`/api/products/${id}`)).status).toBe(200);
    expect((await get(`/api/products/${id}`, "WAREHOUSE_ADMIN")).status).toBe(404);
    expect((await get(`/api/products/${id}`, "VIEWER")).status).toBe(404);
  });

  it("answers 401 without a token and 403 to a platform admin", async () => {
    const id = await world.createProduct("A");

    expect((await request(app).get(`/api/products/${id}`)).status).toBe(401);
    const admin = await request(app).get(`/api/products/${id}`).set("Authorization", world.platformAdmin.authorization);
    expect(admin.status).toBe(403);
  });
});

const send = (method, url, body, role = "OWNER") => request(app)[method](url).set("Authorization", as(role)).send(body);
const productRows = (organizationId) =>
  sql(`SELECT * FROM "Products" WHERE "organizationId" = :organizationId ORDER BY "sku"`, { organizationId });

describe("POST /api/products", () => {
  it("creates a product in the caller's organization: SKU without spaces and uppercase, minStock 0 by default", async () => {
    const res = await send("post", "/api/products", { sku: " ab 12-c ", name: " Teh Botol ", unit: "btl" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organizationId: orgA(),
      sku: "AB12-C",
      name: "Teh Botol",
      unit: "btl",
      minStock: 0,
      archivedAt: null,
    });
    const rows = await productRows(orgA());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: "AB12-C", unit: "btl", minStock: 0 });
  });

  it("stores the given minStock", async () => {
    const res = await send("post", "/api/products", { sku: "A", name: "A", unit: "pak", minStock: 25 });

    expect(res.body.minStock).toBe(25);
  });

  it("answers 409 CONFLICT for a SKU that exists in the organization, however it is written", async () => {
    await send("post", "/api/products", { sku: "SKU-1", name: "Satu", unit: "pcs" });

    const res = await send("post", "/api/products", { sku: " sku -1", name: "Dua", unit: "pcs" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "CONFLICT", message: "SKU sudah dipakai.", details: null });
    expect(await productRows(orgA())).toHaveLength(1);
  });

  it("allows the same SKU in another organization", async () => {
    await world.createProduct("B", "SKU-1");

    expect((await send("post", "/api/products", { sku: "SKU-1", name: "Satu", unit: "pcs" })).status).toBe(201);
  });

  it("lets only one of simultaneous requests for the same SKU win", async () => {
    const results = await Promise.all(
      [1, 2, 3].map((n) => send("post", "/api/products", { sku: "RACE", name: `Produk ${n}`, unit: "pcs" })),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await productRows(orgA())).toHaveLength(1);
  });

  it("rejects an unknown field, organizationId included, and creates nothing", async () => {
    const res = await send("post", "/api/products", {
      sku: "A",
      name: "A",
      unit: "pcs",
      organizationId: world.organizations.B,
    });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ source: "body", path: "organizationId", message: "Field tidak dikenal." }]);
    expect(await productRows(world.organizations.B)).toHaveLength(0);
    expect(await productRows(orgA())).toHaveLength(0);
  });

  it.each([
    [{ name: "A", unit: "pcs" }, "sku"],
    [{ sku: "A", unit: "pcs" }, "name"],
    [{ sku: "A", name: "A" }, "unit"],
    [{ sku: "A", name: "A", unit: "kg" }, "unit"],
    [{ sku: "A", name: "A", unit: "pcs", minStock: -1 }, "minStock"],
    [{ sku: "A", name: "A", unit: "pcs", minStock: 1.5 }, "minStock"],
    [{ sku: "A", name: "A", unit: "pcs", minStock: 1_000_000_001 }, "minStock"],
  ])("answers 400 for %j", async (body, path) => {
    const res = await send("post", "/api/products", body);

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.path)).toContain(path);
  });

  it.each(["WAREHOUSE_ADMIN", "VIEWER"])("answers 403 to a %s before the body is read", async (role) => {
    const res = await send("post", "/api/products", { nonsense: true }, role);

    expect(res.status).toBe(403);
    expect(await productRows(orgA())).toHaveLength(0);
  });
});
