const express = require("express");
const request = require("supertest");
const idempotencyKey = require("../middlewares/idempotencyKey");
const { errorHandler } = require("../middlewares/errorHandler");

// A tiny app with only this middleware: no database is needed to judge a header.
const app = express();
app.use(express.json());
app.post("/stock", idempotencyKey, (req, res) => res.status(201).json({ key: req.idempotencyKey }));
app.use(errorHandler);

const KEY = "3f2b8c1e-9d4a-4e6b-8f10-a1b2c3d4e5f6";

describe("idempotencyKey middleware", () => {
  it("accepts a UUID and hands it to the handler", async () => {
    const res = await request(app).post("/stock").set("Idempotency-Key", KEY).send({});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ key: KEY });
  });

  it("stores the key in lower case, so the same UUID in capitals is the same key", async () => {
    const res = await request(app).post("/stock").set("Idempotency-Key", KEY.toUpperCase()).send({});
    expect(res.status).toBe(201);
    expect(res.body.key).toBe(KEY);
  });

  it("answers 400 VALIDATION_ERROR with a header detail when the header is missing", async () => {
    const res = await request(app).post("/stock").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "VALIDATION_ERROR",
      message: expect.any(String),
      details: [{ source: "header", path: "Idempotency-Key", message: "Wajib diisi." }],
    });
  });

  it.each(["", "abc", "12345", `${KEY}x`,"3f2b8c1e-9d4a-4e6b-8f10-a1b2c3d4e5fg", KEY.replaceAll("-", "")])(
    "answers 400 for the malformed value %p",
    async (value) => {
      const res = await request(app).post("/stock").set("Idempotency-Key", value).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual([{ source: "header", path: "Idempotency-Key", message: expect.any(String) }]);
    },
  );

  it("refuses a repeated header (Node joins the values with a comma)", async () => {
    const res = await request(app).post("/stock").set("Idempotency-Key", `${KEY}, ${KEY}`).send({});
    expect(res.status).toBe(400);
  });

  it("is judged before the body: a bad header and a bad body give the header error", async () => {
    const res = await request(app).post("/stock").set("Idempotency-Key", "nope").send({ anything: 1 });
    expect(res.body.details[0].source).toBe("header");
  });
});
