const express = require("express");
const request = require("supertest");
const { z } = require("zod");
const validate = require("../middlewares/validate");
const { errorHandler, notFoundHandler } = require("../middlewares/errorHandler");

// One POST route that echoes what the controller would receive in req.valid.
function appWith(schemas, method = "post", path = "/items/:id") {
  const app = express();
  app.use(express.json());
  app[method](path, validate(schemas), (req, res) => res.json(req.valid));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("validate: body", () => {
  const app = appWith({ body: z.object({ name: z.string().min(1) }) });

  it("passes valid input to req.valid.body", async () => {
    const res = await request(app).post("/items/1").send({ name: "Gula" });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ name: "Gula" });
  });

  it("rejects a wrong value with 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/items/1").send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { source: "body", path: "name", message: expect.any(String) },
    ]);
  });

  it("rejects an unknown key even when the schema is a plain z.object", async () => {
    const res = await request(app)
      .post("/items/1")
      .send({ name: "Gula", organizationId: "x" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0]).toMatchObject({ source: "body" });
  });

  it("keeps refinements when it makes the schema strict", async () => {
    const withRefine = appWith({
      body: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b, {
        message: "a harus lebih kecil dari b",
      }),
    });
    const res = await request(withRefine).post("/items/1").send({ a: 2, b: 1 });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.details)).toMatch(/lebih kecil/);
  });

  it("treats a missing body as an empty object", async () => {
    const res = await request(app).post("/items/1");

    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe("name");
  });
});

describe("validate: query and params", () => {
  const app = appWith(
    {
      params: z.object({ id: z.uuid() }),
      query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
    },
    "get",
  );
  const id = "6f1c3a52-0d8c-4a7e-9f0e-1c6b0a1b2c3d";

  it("coerces query values and fills defaults into req.valid.query", async () => {
    const res = await request(app).get(`/items/${id}?page=3`);

    expect(res.status).toBe(200);
    expect(res.body.query).toEqual({ page: 3 });
    expect(res.body.params).toEqual({ id });
  });

  it("uses the default when the query is empty", async () => {
    const res = await request(app).get(`/items/${id}`);

    expect(res.body.query).toEqual({ page: 1 });
  });

  it("rejects a bad query with source 'query'", async () => {
    const res = await request(app).get(`/items/${id}?page=0`);

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { source: "query", path: "page", message: expect.any(String) },
    ]);
  });

  it("rejects an unknown query key", async () => {
    const res = await request(app).get(`/items/${id}?page=1&role=owner`);

    expect(res.status).toBe(400);
    expect(res.body.details[0].source).toBe("query");
  });

  it("rejects a bad path parameter with source 'params'", async () => {
    const res = await request(app).get("/items/not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.details[0]).toMatchObject({ source: "params", path: "id" });
  });
});

describe("validate: headers", () => {
  const app = appWith({
    headers: z.object({ "idempotency-key": z.uuid() }),
  });

  it("reads lower-case header names and ignores the other headers", async () => {
    const key = "6f1c3a52-0d8c-4a7e-9f0e-1c6b0a1b2c3d";
    const res = await request(app).post("/items/1").set("Idempotency-Key", key).send({});

    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual({ "idempotency-key": key });
  });

  it("rejects a missing header with source 'header'", async () => {
    const res = await request(app).post("/items/1").send({});

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([
      { source: "header", path: "idempotency-key", message: expect.any(String) },
    ]);
  });
});

describe("validate: reporting", () => {
  it("collects problems from several sources in one response", async () => {
    const app = appWith({
      params: z.object({ id: z.uuid() }),
      body: z.object({ name: z.string() }),
    });
    const res = await request(app).post("/items/x").send({});

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.source).sort()).toEqual(["body", "params"]);
  });

  it("refuses to build without any schema (a programming error)", () => {
    expect(() => validate({})).toThrow(/at least one schema/i);
  });
});
