const express = require("express");
const request = require("supertest");
const app = require("../app");
const db = require("../models");
const { createHealthController } = require("../controllers/healthController");

afterAll(() => db.sequelize.close());

const appWith = (options) => {
  const server = express();
  server.get("/api/health", createHealthController(options));
  return server;
};

describe("GET /api/health against the real app and database", () => {
  it("answers 200 with the documented body, without a token", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      app: { commit: null },
      database: { status: "up", latencyMs: expect.any(Number) },
    });
    expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("is never cached by a browser or a proxy", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("has a request ID header like every other route", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("health controller with a stubbed database check", () => {
  it("answers 503 with the documented body when the database is down", async () => {
    const res = await request(
      appWith({ check: async () => ({ status: "down" }), commit: () => null }),
    ).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "error",
      app: { commit: null },
      database: { status: "down" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("shows the commit when it is set", async () => {
    const res = await request(
      appWith({
        check: async () => ({ status: "up", latencyMs: 3 }),
        commit: () => "abc1234",
      }),
    ).get("/api/health");

    expect(res.body.app).toEqual({ commit: "abc1234" });
  });

  it("answers 503 and leaks nothing when the real check fails", async () => {
    const { createDatabaseCheck } = require("../helpers/databaseHealth");
    const check = createDatabaseCheck(async () => {
      throw new Error(
        "password authentication failed for user admin at db.secret.host",
      );
    });
    const res = await request(appWith({ check, commit: () => null })).get(
      "/api/health",
    );

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(
      /password|admin|secret|host|version/i,
    );
  });
});
