const express = require("express");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const authentication = require("../middlewares/authentication");
const { errorHandler } = require("../middlewares/errorHandler");
const { signToken } = require("../helpers/jwt");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createAccount, readUser } = require("./support/accounts");
const { createOrganization } = require("./support/factories");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

const bearer = (user) => `Bearer ${signToken(user.id)}`;

// Two organizations; the caller belongs to the first.
async function setup() {
  const mine = await createOrganization("tokosaya");
  const theirs = await createOrganization("tokolain");
  const user = await createAccount({ organizationId: mine });
  return { mine, theirs, user };
}

describe("organizationId sent by the caller is never used (rule 1)", () => {
  it("in the query string: GET /api/me still answers with the caller's own organization", async () => {
    const { mine, theirs, user } = await setup();

    const res = await request(app)
      .get(`/api/me?organizationId=${theirs}`)
      .set("Authorization", bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(mine);
  });

  it("in the body: a route that validates rejects it as an unknown key", async () => {
    const { theirs, user } = await setup();

    const res = await request(app)
      .patch("/api/me/password")
      .set("Authorization", bearer(user))
      .send({
        currentPassword: user.password,
        newPassword: "Kopi-Susu-2027!",
        organizationId: theirs,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.details)).toContain("organizationId");
    expect((await readUser(user.id)).organizationId).toBe(user.organizationId);
  });

  describe("on a route that does not validate, req.ctx still holds the session's organization", () => {
    const probe = express();
    probe.use(express.json());
    probe.post("/probe/:organizationId", authentication, (req, res) => res.json({ ctx: req.ctx }));
    probe.use(errorHandler);

    it("in the URL params, the query string and the body at the same time", async () => {
      const { mine, theirs, user } = await setup();

      const res = await request(probe)
        .post(`/probe/${theirs}?organizationId=${theirs}`)
        .set("Authorization", bearer(user))
        .send({ organizationId: theirs });

      expect(res.status).toBe(200);
      expect(res.body.ctx.organizationId).toBe(mine);
    });
  });
});
