const request = require("supertest");
const app = require("../app");

describe("unknown routes", () => {
  it("answers 404 with the standard error body", async () => {
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toEqual({
      code: "NOT_FOUND",
      message: expect.any(String),
      details: null,
    });
  });

  it("answers 404 for any method", async () => {
    const res = await request(app).post("/api/does-not-exist").send({ a: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
