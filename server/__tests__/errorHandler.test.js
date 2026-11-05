const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const {
  Sequelize,
  UniqueConstraintError,
  ValidationError,
  ValidationErrorItem,
} = require("sequelize");
const { errorHandler, notFoundHandler } = require("../middlewares/errorHandler");
const errors = require("../helpers/errors");

// A tiny app: one route that throws what the test says, the same handlers as app.js.
function appThrowing(thrower, { async = false } = {}) {
  const app = express();
  app.use(express.json());
  app.post("/boom", async ? async () => thrower() : () => thrower());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const call = (thrower, options) => request(appThrowing(thrower, options)).post("/boom").send({});

const expectBody = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toMatch(/application\/json/);
  expect(Object.keys(res.body).sort()).toEqual(["code", "details", "message"]);
  expect(res.body.code).toBe(code);
  expect(res.body.message).toMatch(/\S/);
};

describe("AppError", () => {
  it.each([
    ["validationError", 400, "VALIDATION_ERROR"],
    ["invalidCurrentPassword", 400, "INVALID_CURRENT_PASSWORD"],
    ["unauthenticated", 401, "UNAUTHENTICATED"],
    ["invalidCredentials", 401, "INVALID_CREDENTIALS"],
    ["forbidden", 403, "FORBIDDEN"],
    ["planLimitReached", 403, "PLAN_LIMIT_REACHED"],
    ["subscriptionReadOnly", 403, "SUBSCRIPTION_READ_ONLY"],
    ["notFound", 404, "NOT_FOUND"],
    ["conflict", 409, "CONFLICT"],
    ["internalError", 500, "INTERNAL_ERROR"],
  ])("%s is answered with %i %s", async (builder, status, code) => {
    const res = await call(() => {
      throw errors[builder]();
    });

    expectBody(res, status, code);
  });

  it("INSUFFICIENT_STOCK is 409 and carries the product ID", async () => {
    const res = await call(() => {
      throw errors.insufficientStock("p-1");
    });

    expectBody(res, 409, "INSUFFICIENT_STOCK");
    expect(res.body.details).toEqual({ productId: "p-1" });
  });

  it("keeps validation details as [{ source, path, message }]", async () => {
    const details = [{ source: "body", path: "email", message: "Wajib diisi." }];
    const res = await call(() => {
      throw errors.validationError(details);
    });

    expect(res.body.details).toEqual(details);
  });

  it("is also handled when an async handler rejects", async () => {
    const res = await call(
      () => {
        throw errors.forbidden();
      },
      { async: true },
    );

    expectBody(res, 403, "FORBIDDEN");
  });
});

describe("Sequelize errors", () => {
  it("a unique violation is 409 CONFLICT", async () => {
    const res = await call(() => {
      throw new UniqueConstraintError({
        message: 'duplicate key value violates unique constraint "x"',
        errors: [],
      });
    });

    expectBody(res, 409, "CONFLICT");
    expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|constraint/i);
  });

  it("a validation error is 400 with details and our own messages", async () => {
    const res = await call(() => {
      throw new ValidationError("Validation error", [
        new ValidationErrorItem("name cannot be null", "notNull Violation", "name", null),
      ]);
    });

    expectBody(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { source: "body", path: "name", message: "Nilai tidak valid." },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/cannot be null/);
  });

  it("another database error is 500 and shows no SQL", async () => {
    const res = await call(() => {
      const err = new Sequelize.DatabaseError(new Error("relation \"users\" does not exist"));
      err.sql = 'SELECT * FROM "users"';
      throw err;
    });

    expectBody(res, 500, "INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|users|relation/);
  });
});

describe("JWT errors", () => {
  it("a bad token is 401 UNAUTHENTICATED", async () => {
    const res = await call(() => jwt.verify("not-a-token", "secret"));

    expectBody(res, 401, "UNAUTHENTICATED");
  });

  it("an expired token is 401 UNAUTHENTICATED", async () => {
    const token = jwt.sign({ a: 1 }, "secret", { expiresIn: -10 });
    const res = await call(() => jwt.verify(token, "secret"));

    expectBody(res, 401, "UNAUTHENTICATED");
  });
});

describe("malformed JSON", () => {
  it("is 400 VALIDATION_ERROR", async () => {
    const res = await request(appThrowing(() => {}))
      .post("/boom")
      .set("Content-Type", "application/json")
      .send("{");

    expectBody(res, 400, "VALIDATION_ERROR");
  });
});

describe("anything else", () => {
  it("is 500 INTERNAL_ERROR with no stack, no message and no cause", async () => {
    const res = await call(() => {
      throw new Error("secret detail at /home/app/server.js:12");
    });

    expectBody(res, 500, "INTERNAL_ERROR");
    expect(res.body.details).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/secret detail|server\.js|\bat \w+/);
    expect(res.body).not.toHaveProperty("stack");
  });

  it("is 500 even when a non-Error value is thrown", async () => {
    const res = await call(() => {
      throw "just a string";
    });

    expectBody(res, 500, "INTERNAL_ERROR");
  });
});

describe("unknown route", () => {
  it("is 404 NOT_FOUND with the standard body", async () => {
    const res = await request(appThrowing(() => {})).get("/nowhere");

    expectBody(res, 404, "NOT_FOUND");
    expect(res.body.details).toBeNull();
  });
});
