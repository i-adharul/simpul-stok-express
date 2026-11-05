const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { TENANT_ENDPOINTS, foreignBodyProblems } = require("./support/registry");

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

// docs/06: a write under stock/, transfers or imports has one foreignBodies variant for each key
// of its body that ends in "Id" and holds a UUID, each replacing exactly that key.
describe("stock writes in the registry have a foreignBodies variant per Id key", () => {
  it("holds for every real entry", async () => {
    const problems = [];
    for (const entry of TENANT_ENDPOINTS) problems.push(...(await foreignBodyProblems(entry, world)));
    expect(problems).toEqual([]);
  });

  it("checks at least one real stock write (the rule is not vacuous)", () => {
    expect(TENANT_ENDPOINTS.some((entry) => entry.method === "post" && entry.path.startsWith("/api/stock/"))).toBe(true);
  });
});

describe("the rule itself", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const entry = (extra) => ({ method: "post", path: "/api/stock/receive", body: () => ({ warehouseId: A, productId: B, quantity: 1 }), ...extra });
  const variant = (key) => ({ key, body: (_world, id) => ({ warehouseId: A, productId: B, quantity: 1, [key]: id }) });

  it("passes when every Id key has its variant", async () => {
    expect(await foreignBodyProblems(entry({ foreignBodies: [variant("warehouseId"), variant("productId")] }), {})).toEqual([]);
  });

  it("reports a missing variant by key name", async () => {
    const problems = await foreignBodyProblems(entry({ foreignBodies: [variant("warehouseId")] }), {});
    expect(problems).toEqual([expect.stringMatching(/"productId" has no foreignBodies variant/)]);
  });

  it("reports an entry with no foreignBodies at all, once per key", async () => {
    expect(await foreignBodyProblems(entry({}), {})).toHaveLength(2);
  });

  it("reports a variant that changes the wrong key or two keys", async () => {
    const wrong = { key: "productId", body: (_w, id) => ({ warehouseId: id, productId: B, quantity: 1 }) };
    const both = { key: "warehouseId", body: (_w, id) => ({ warehouseId: id, productId: id, quantity: 1 }) };
    const problems = await foreignBodyProblems(entry({ foreignBodies: [wrong, both] }), {});
    expect(problems.join("\n")).toMatch(/"productId" variant does not put the foreign id in "productId"/);
    expect(problems.join("\n")).toMatch(/"warehouseId" variant also changes "productId"/);
  });

  it("ignores reads and writes outside stock/, transfers and imports", async () => {
    expect(await foreignBodyProblems(entry({ method: "get" }), {})).toEqual([]);
    expect(await foreignBodyProblems(entry({ path: "/api/warehouses" }), {})).toEqual([]);
  });

  it("covers transfers and imports paths", async () => {
    expect(await foreignBodyProblems(entry({ path: "/api/stock/transfers" }), {})).toHaveLength(2);
    expect(await foreignBodyProblems(entry({ path: "/api/transfers/:id/send" }), {})).toHaveLength(2);
    expect(await foreignBodyProblems(entry({ path: "/api/imports/:id/commit" }), {})).toHaveLength(2);
  });
});
