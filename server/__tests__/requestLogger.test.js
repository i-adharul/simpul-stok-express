const express = require("express");
const request = require("supertest");
const { createLogger } = require("../helpers/logger");
const { createRequestLogger } = require("../middlewares/requestLogger");
const app = require("../app");

const buildApp = () => {
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  const server = express();
  server.use(createRequestLogger(logger));
  server.use(express.json());
  server.post("/login", (req, res) => res.status(200).json({ ok: true }));
  server.get("/invitations/:token", (req, res) => res.sendStatus(404));
  server.get("/slow", (req, res) => setTimeout(() => res.json({}), 30));
  server.get("/boom", (req, res) => res.status(500).json({ code: "INTERNAL" }));
  return {
    server,
    entries: () => lines.map((line) => JSON.parse(line)),
    lines,
  };
};

describe("requestLogger", () => {
  it("logs request ID, method, path, status and duration as one JSON line", async () => {
    const { server, entries, lines } = buildApp();
    await request(server).post("/login").send({ email: "a@example.com" });

    expect(lines).toHaveLength(1);
    expect(entries()[0]).toEqual({
      time: expect.any(String),
      level: "info",
      message: "request",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      method: "POST",
      path: "/login",
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it("never logs the request body, even a password", async () => {
    const { server, lines } = buildApp();
    await request(server)
      .post("/login")
      .send({ email: "a@example.com", password: "Rahasia-12345" });

    expect(lines.join("")).not.toContain("Rahasia-12345");
    expect(lines.join("")).not.toContain("a@example.com");
  });

  it("never logs the Authorization header", async () => {
    const { server, lines } = buildApp();
    await request(server)
      .post("/login")
      .set("Authorization", "Bearer abc.def.ghi")
      .send({});

    expect(lines.join("")).not.toContain("abc.def.ghi");
  });

  it("logs the route pattern, so a token in the URL is not printed", async () => {
    const { server, entries, lines } = buildApp();
    await request(server).get("/invitations/SECRET-TOKEN-123");

    expect(entries()[0].path).toBe("/invitations/:token");
    expect(lines.join("")).not.toContain("SECRET-TOKEN-123");
  });

  it("does not log the query string of an unmatched path", async () => {
    const { server, entries, lines } = buildApp();
    await request(server).get("/nowhere?token=SECRET-QUERY");

    expect(entries()[0]).toMatchObject({ path: "/nowhere", status: 404 });
    expect(lines.join("")).not.toContain("SECRET-QUERY");
  });

  it("measures the duration", async () => {
    const { server, entries } = buildApp();
    await request(server).get("/slow");

    expect(entries()[0].durationMs).toBeGreaterThanOrEqual(25);
  });

  it("uses the level warn for 4xx and error for 5xx", async () => {
    const { server, entries } = buildApp();
    await request(server).get("/nowhere");
    await request(server).get("/boom");

    expect(entries().map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("returns the ID in X-Request-Id and gives each request a new one", async () => {
    const { server, entries } = buildApp();
    const first = await request(server).get("/slow");
    const second = await request(server).get("/slow");

    expect(first.headers["x-request-id"]).toBe(entries()[0].requestId);
    expect(second.headers["x-request-id"]).not.toBe(
      first.headers["x-request-id"],
    );
  });

  it("ignores a request ID sent by the client", async () => {
    const { server, entries } = buildApp();
    await request(server).get("/slow").set("X-Request-Id", "forged");

    expect(entries()[0].requestId).not.toBe("forged");
  });

  it("is wired into the real app", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
