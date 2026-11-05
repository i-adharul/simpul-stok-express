const request = require("supertest");
const app = require("../app");

// helmet sets these on every response, so any route will do. /api/does-not-exist is a 404 and
// proves the headers are also on error responses.
describe("security headers (helmet)", () => {
  it.each([
    ["/api/health", 200],
    ["/api/does-not-exist", 404],
  ])("%s answers %i with the headers", async (path) => {
    const res = await request(app).get(path);

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("does not announce the framework", async () => {
    const res = await request(app).get("/api/health");

    expect(res.headers).not.toHaveProperty("x-powered-by");
  });

  it("is also on a POST that fails validation", async () => {
    const res = await request(app).post("/api/auth/login").send({});

    expect(res.status).toBe(400);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers).not.toHaveProperty("x-powered-by");
  });
});
