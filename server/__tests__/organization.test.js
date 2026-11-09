const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount } = require("./support/accounts");

jest.setTimeout(30000);

let owner;
const auth = () => `Bearer ${signToken(owner.id)}`;
const patch = (body) => request(app).patch("/api/organization").set("Authorization", auth()).send(body);
const me = () => request(app).get("/api/me").set("Authorization", auth());

beforeEach(async () => {
  await clearTables(getSequelize());
  owner = await createAccount({ role: "OWNER" });
});
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("PATCH /api/organization", () => {
  it("shows the new name in GET /api/me, and the new name and address in GET /api/organization", async () => {
    const res = await patch({ name: "  Toko Sentosa ", address: " Jl. Merdeka 1 " });

    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ name: "Toko Sentosa", address: "Jl. Merdeka 1" });
    expect((await me()).body.organization.name).toBe("Toko Sentosa");
    const read = await request(app).get("/api/organization").set("Authorization", auth());
    expect(read.body.organization).toMatchObject({ name: "Toko Sentosa", address: "Jl. Merdeka 1" });
  });

  it("changes one field and keeps the other", async () => {
    await patch({ name: "Toko Sentosa", address: "Jl. Merdeka 1" });

    const res = await patch({ name: "Toko Baru" });

    expect(res.body.organization).toMatchObject({ name: "Toko Baru", address: "Jl. Merdeka 1" });
  });

  it("stores an empty address as null", async () => {
    await patch({ address: "Jl. Merdeka 1" });

    const res = await patch({ address: "   " });

    expect(res.status).toBe(200);
    expect(res.body.organization.address).toBeNull();
  });

  it("never changes the slug or the status", async () => {
    const before = (await request(app).get("/api/organization").set("Authorization", auth())).body.organization;

    await patch({ name: "Nama Lain" });
    const after = (await request(app).get("/api/organization").set("Authorization", auth())).body.organization;

    expect(after.slug).toBe(before.slug);
    expect(after.status).toBe(before.status);
    expect(after.id).toBe(before.id);
  });

  it.each([["slug", "baru"], ["status", "ACTIVE"], ["id", "x"], ["organizationId", "x"]])(
    "rejects %s with 400 and changes nothing",
    async (key, value) => {
      const res = await patch({ name: "Nama Lain", [key]: value });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details.map((d) => d.path)).toEqual([key]);
      expect((await me()).body.organization.name).toBe("Toko");
    },
  );

  it.each([
    ["an empty body", {}],
    ["a blank name", { name: "   " }],
    ["a name of 101 characters", { name: "a".repeat(101) }],
    ["an address of 256 characters", { address: "a".repeat(256) }],
    ["a name that is not text", { name: 5 }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts the longest name and address", async () => {
    const res = await patch({ name: "a".repeat(100), address: "b".repeat(255) });

    expect(res.status).toBe(200);
    expect(res.body.organization.name).toHaveLength(100);
    expect(res.body.organization.address).toHaveLength(255);
  });
});
