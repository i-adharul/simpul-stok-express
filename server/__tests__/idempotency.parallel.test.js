const crypto = require("crypto");
const request = require("supertest");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");
const { buildIdempotentTestApp } = require("./support/idempotentTestApp");

jest.setTimeout(60000);

const app = buildIdempotentTestApp();
let world;
beforeEach(async () => {
  await clearTables(getSequelize());
  world = await createWorld();
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];
const count = async (table) =>
  Number((await sql(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = :id`, { id: world.organizations.A }))[0].n);
const send = (key, code) =>
  request(app).post("/test/warehouses").set("Authorization", world.users.A.OWNER.authorization).set("Idempotency-Key", key).send({ code });

describe("five parallel requests with one key", () => {
  it("leave one effect and one equal answer, when the work itself would succeed in each (different codes)", async () => {
    const key = crypto.randomUUID();

    const responses = await Promise.all([1, 2, 3, 4, 5].map((n) => send(key, `GD-${n}`)));

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(responses.filter((r) => r.headers["idempotency-replayed"] === "true")).toHaveLength(4);
    expect(await count("Warehouses")).toBe(1);
    expect(await count("IdempotencyKeys")).toBe(1);
  });

  it("leave one effect when the losers would fail on a business rule (the same warehouse code)", async () => {
    const key = crypto.randomUUID();

    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => send(key, "GD-SAME")));

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await count("Warehouses")).toBe(1);
    expect(await count("IdempotencyKeys")).toBe(1);
  });

  it("make five separate effects when the keys differ", async () => {
    const responses = await Promise.all([1, 2, 3, 4, 5].map((n) => send(crypto.randomUUID(), `GD-${n}`)));

    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await count("Warehouses")).toBe(5);
    expect(await count("IdempotencyKeys")).toBe(5);
  });
});

describe("a failed request", () => {
  it("stores no key and leaves no effect, so the same key can be sent again", async () => {
    const key = crypto.randomUUID();

    const failed = await send(key, "FAIL");
    expect(failed.status).toBe(409);
    expect(failed.body.code).toBe("CONFLICT");
    expect(await count("Warehouses")).toBe(0);
    expect(await count("IdempotencyKeys")).toBe(0);

    const retry = await send(key, "GD-OK");
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();
    expect(await count("Warehouses")).toBe(1);
    expect(await count("IdempotencyKeys")).toBe(1);
  });

  it("stores no key for a request rejected by the header check", async () => {
    const res = await send("nope", "GD-1");
    expect(res.status).toBe(400);
    expect(await count("IdempotencyKeys")).toBe(0);
  });
});
