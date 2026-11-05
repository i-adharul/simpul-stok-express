const request = require("supertest");
const app = require("../app");
const env = require("../config/env");

const ALLOWED = env.CORS_ORIGIN[0];
const ACAO = "access-control-allow-origin";

describe("CORS allowlist", () => {
  it("the configured list has no wildcard", () => {
    expect(env.CORS_ORIGIN).not.toContain("*");
    expect(env.CORS_ORIGIN.length).toBeGreaterThan(0);
  });

  it("an allowed origin gets exactly that origin back, never *", async () => {
    const res = await request(app).get("/api/health").set("Origin", ALLOWED);

    expect(res.headers[ACAO]).toBe(ALLOWED);
    expect(res.headers[ACAO]).not.toBe("*");
    expect(res.headers.vary).toMatch(/Origin/);
  });

  it("a foreign origin gets no Access-Control-Allow-Origin", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");

    expect(res.status).toBe(200);
    expect(res.headers).not.toHaveProperty(ACAO);
  });

  it.each([
    ["the null origin (sandboxed pages)", "null"],
    ["the same host on another port", ALLOWED.replace(/:\d+$/, ":9999")],
    ["the other scheme", ALLOWED.replace(/^http:/, "https:")],
    ["a subdomain of the allowed host", ALLOWED.replace("://", "://evil.")],
    ["the allowed origin as a prefix of another host", `${ALLOWED}.evil.example`],
    ["the allowed origin in another letter case", ALLOWED.toUpperCase()],
  ])("%s gets no Access-Control-Allow-Origin", async (_name, origin) => {
    const res = await request(app).get("/api/health").set("Origin", origin);

    expect(res.headers).not.toHaveProperty(ACAO);
  });

  it("never allows credentials", async () => {
    const res = await request(app).get("/api/health").set("Origin", ALLOWED);

    expect(res.headers).not.toHaveProperty("access-control-allow-credentials");
  });

  it("a request without an Origin header is served normally", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.headers).not.toHaveProperty(ACAO);
  });

  it("an error response from an allowed origin is readable by that origin", async () => {
    const res = await request(app).post("/api/auth/login").set("Origin", ALLOWED).send({});

    expect(res.status).toBe(400);
    expect(res.headers[ACAO]).toBe(ALLOWED);
  });
});

describe("CORS preflight", () => {
  const preflight = (origin) =>
    request(app)
      .options("/api/auth/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type,idempotency-key");

  it("an allowed origin may use the methods and headers of the API", async () => {
    const res = await preflight(ALLOWED);

    expect(res.status).toBe(204);
    expect(res.headers[ACAO]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-methods"]).toMatch(/PATCH/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/);
    expect(res.headers["access-control-allow-headers"]).toMatch(/Idempotency-Key/);
  });

  it("a foreign origin gets no Access-Control-Allow-Origin on the preflight", async () => {
    const res = await preflight("https://evil.example");

    expect(res.headers).not.toHaveProperty(ACAO);
  });
});
