const express = require("express");
const request = require("supertest");
const db = require("../models");
const { findOwned } = require("../helpers/ownership");
const { tenant } = require("../helpers/tenantScope");
const { errorHandler } = require("../middlewares/errorHandler");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

// Acceptance: the three 404 cases look exactly the same, so existence does not leak (rule 2).
const MISSING = "33333333-3333-4333-8333-333333333333";

async function setup() {
  const a = await createOrganization("tokoa");
  const b = await createOrganization("tokob");
  const warehouseB = await tenant({ organizationId: b }).Warehouse.create({ code: "GD-B", name: "Gudang B" });
  return { ctxA: { organizationId: a }, foreignId: warehouseB.id };
}

describe("the three 404 cases give exactly the same answer", () => {
  it("same message, code, status and details from findOwned", async () => {
    const { ctxA, foreignId } = await setup();

    const [missing, foreign, notUuid] = await Promise.all(
      [MISSING, foreignId, "not-a-uuid"].map((id) => findOwned(ctxA, "Warehouse", id).catch((e) => e)),
    );

    expect(missing.message).toBe("Data tidak ditemukan.");
    expect(foreign.message).toBe(missing.message);
    expect(notUuid.message).toBe(missing.message);
    expect(JSON.stringify(foreign.toBody())).toBe(JSON.stringify(missing.toBody()));
    expect(JSON.stringify(notUuid.toBody())).toBe(JSON.stringify(missing.toBody()));
    expect([missing.status, foreign.status, notUuid.status]).toEqual([404, 404, 404]);
  });

  it("the HTTP responses are byte-identical (status, body text and content length)", async () => {
    const { ctxA, foreignId } = await setup();
    const app = express();
    app.get("/warehouses/:id", async (req, res) => {
      res.json(await findOwned(ctxA, "Warehouse", req.params.id));
    });
    app.use(errorHandler);

    const responses = [];
    for (const id of [MISSING, foreignId, "not-a-uuid"]) {
      responses.push(await request(app).get(`/warehouses/${id}`));
    }

    expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
    expect(responses[1].text).toBe(responses[0].text);
    expect(responses[2].text).toBe(responses[0].text);
    expect(responses[1].headers["content-length"]).toBe(responses[0].headers["content-length"]);
    expect(JSON.parse(responses[0].text)).toEqual({
      code: "NOT_FOUND",
      message: "Data tidak ditemukan.",
      details: null,
    });
  });

  it("neither the foreign ID nor its organization appears in the answer", async () => {
    const { ctxA, foreignId } = await setup();

    const error = await findOwned(ctxA, "Warehouse", foreignId).catch((e) => e);

    expect(JSON.stringify(error.toBody())).not.toContain(foreignId);
    expect(JSON.stringify(error.toBody())).not.toMatch(/organization|GD-B/i);
  });
});
