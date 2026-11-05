const crypto = require("crypto");
const request = require("supertest");
const db = require("../models");
const { getSequelize } = require("./support/db");
const { buildIdempotentTestApp } = require("./support/idempotentTestApp");
const { clearTables } = require("./support/clearTables");
const { createWorld } = require("./support/factories");

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
const count = async (table, organizationId) =>
  Number((await sql(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = :organizationId`, { organizationId }))[0].n);
const send = (who, key, code = "GD-1") => {
  const req = request(app).post("/test/warehouses").set("Authorization", who.authorization);
  return (key === undefined ? req : req.set("Idempotency-Key", key)).send({ code });
};
const ownerA = () => world.users.A.OWNER;
const orgA = () => world.organizations.A;

describe("the same key twice", () => {
  it("has one effect and an equal response; only the second carries Idempotency-Replayed", async () => {
    const key = crypto.randomUUID();

    const first = await send(ownerA(), key);
    const second = await send(ownerA(), key, "GD-OTHER"); // the body of a repeated request is not compared

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(await count("Warehouses", orgA())).toBe(1);
    expect(await count("IdempotencyKeys", orgA())).toBe(1);
  });

  it("treats the same UUID in capitals as the same key", async () => {
    const key = crypto.randomUUID();
    await send(ownerA(), key);
    const again = await send(ownerA(), key.toUpperCase());

    expect(again.headers["idempotency-replayed"]).toBe("true");
    expect(await count("Warehouses", orgA())).toBe(1);
  });
});

describe("different keys", () => {
  it("make separate effects with separate responses", async () => {
    const first = await send(ownerA(), crypto.randomUUID(), "GD-1");
    const second = await send(ownerA(), crypto.randomUUID(), "GD-2");

    expect(first.body.id).not.toBe(second.body.id);
    expect(second.headers["idempotency-replayed"]).toBeUndefined();
    expect(await count("Warehouses", orgA())).toBe(2);
    expect(await count("IdempotencyKeys", orgA())).toBe(2);
  });
});

describe("another organization's key", () => {
  it("does not leak: the same key in organization B is a new key with B's own effect", async () => {
    const key = crypto.randomUUID();
    const a = await send(ownerA(), key, "GD-A");
    const b = await send(world.users.B.OWNER, key, "GD-B");

    expect(b.status).toBe(201);
    expect(b.headers["idempotency-replayed"]).toBeUndefined();
    expect(b.body.code).toBe("GD-B");
    expect(b.body.id).not.toBe(a.body.id);
    expect(await count("Warehouses", world.organizations.A)).toBe(1);
    expect(await count("Warehouses", world.organizations.B)).toBe(1);
    expect(await count("IdempotencyKeys", world.organizations.B)).toBe(1);
  });

  it("never lets B replay A's stored resource", async () => {
    const key = crypto.randomUUID();
    const a = await send(ownerA(), key, "GD-A");
    const b = await send(world.users.B.OWNER, key, "GD-A2");
    expect(b.body).not.toEqual(a.body);
  });
});

describe("authorization comes before the replay", () => {
  it("answers a Viewer 403, not a replay, even when the key exists", async () => {
    const key = crypto.randomUUID();
    await send(ownerA(), key);

    const res = await send(world.users.A.VIEWER, key);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(res.headers["idempotency-replayed"]).toBeUndefined();
    expect(await count("Warehouses", orgA())).toBe(1);
  });

  it("answers 403 to a role that may not act before the header is looked at", async () => {
    const res = await send(world.users.A.VIEWER, undefined);
    expect(res.status).toBe(403);
  });
});

describe("the header is required", () => {
  it.each([undefined, "not-a-uuid"])("answers 400 for %p and creates nothing", async (key) => {
    const res = await send(ownerA(), key);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([{ source: "header", path: "Idempotency-Key", message: expect.any(String) }]);
    expect(await count("Warehouses", orgA())).toBe(0);
    expect(await count("IdempotencyKeys", orgA())).toBe(0);
  });
});
