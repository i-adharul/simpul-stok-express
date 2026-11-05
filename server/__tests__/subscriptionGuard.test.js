const express = require("express");
const request = require("supertest");
const subscriptionGuard = require("../middlewares/subscriptionGuard");

describe("subscriptionGuard (temporary BL23 hook, E2-07)", () => {
  it("calls next() with no error and does not touch the response", () => {
    const next = jest.fn();
    const res = { status: jest.fn(), json: jest.fn(), end: jest.fn() };

    subscriptionGuard({ ctx: { organizationId: "o" } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("lets every request through for now, whatever the role or the organization", async () => {
    const app = express();
    app.post("/x", (req, res, next) => {
      req.ctx = { role: req.get("X-Role"), organizationId: null };
      next();
    }, subscriptionGuard, (req, res) => res.status(201).json({ ok: true }));

    for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER", "PLATFORM_ADMIN"]) {
      const res = await request(app).post("/x").set("X-Role", role);
      expect(res.status).toBe(201);
    }
  });

  it("is a plain middleware (req, res, next) that the route inspector can recognise", () => {
    expect(typeof subscriptionGuard).toBe("function");
    expect(subscriptionGuard).toHaveLength(3);
    expect(subscriptionGuard.isSubscriptionGuard).toBe(true);
  });
});
