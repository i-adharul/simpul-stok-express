const express = require("express");
const { z } = require("zod");
const app = require("../app");
const validate = require("../middlewares/validate");
const { listRoutes, findUnvalidatedWriteRoutes } = require("./support/routeInspector");

// Write routes that are allowed to skip `validate`, with the reason. Keep this list short.
// The label is "<METHOD> <path as declared in the router>". It is empty today.
//   Example (added later, with its reason): "POST /webhooks/xendit" - the body is checked by
//   verifying the signature of the raw bytes, not by a Zod schema.
const ALLOWED_WITHOUT_VALIDATE = [];

describe("rule 4: every write route validates its input", () => {
  it("finds the routes of the real app (the inspector is not blind)", () => {
    const labels = listRoutes(app).map((route) => route.label);

    expect(labels).toContain("GET /health");
  });

  it("no POST, PUT, PATCH or DELETE route of the real app skips validate", () => {
    expect(findUnvalidatedWriteRoutes(app, ALLOWED_WITHOUT_VALIDATE)).toEqual([]);
  });
});

describe("the inspector itself", () => {
  const schemas = { body: z.object({}) };
  const handler = (req, res) => res.end();

  it("flags a write route without validate, for each write method", () => {
    const fake = express();
    fake.post("/a", handler);
    fake.put("/b", handler);
    fake.patch("/c", handler);
    fake.delete("/d", handler);
    fake.all("/e", handler);

    expect(findUnvalidatedWriteRoutes(fake)).toEqual([
      "POST /a",
      "PUT /b",
      "PATCH /c",
      "DELETE /d",
      // Express expands app.all() into one route entry per method.
      "DELETE /e",
      "PATCH /e",
      "POST /e",
      "PUT /e",
    ]);
  });

  it("accepts a write route that has validate before the controller", () => {
    const fake = express();
    fake.post("/a", validate(schemas), handler);

    expect(findUnvalidatedWriteRoutes(fake)).toEqual([]);
  });

  it("does not accept validate placed after the controller", () => {
    const fake = express();
    fake.post("/a", handler, validate(schemas));

    expect(findUnvalidatedWriteRoutes(fake)).toEqual(["POST /a"]);
  });

  it("ignores GET routes", () => {
    const fake = express();
    fake.get("/a", handler);

    expect(findUnvalidatedWriteRoutes(fake)).toEqual([]);
  });

  it("finds write routes inside a nested router", () => {
    const fake = express();
    const router = express.Router();
    router.post("/inner", handler);
    fake.use("/outer", router);

    expect(findUnvalidatedWriteRoutes(fake)).toEqual(["POST /inner"]);
  });

  it("skips only the routes on the allowed list", () => {
    const fake = express();
    fake.post("/hook", handler);
    fake.post("/other", handler);

    expect(findUnvalidatedWriteRoutes(fake, ["POST /hook"])).toEqual(["POST /other"]);
  });
});
