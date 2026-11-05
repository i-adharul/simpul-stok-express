const errors = require("../helpers/errors");

const { AppError, ERROR_CODES } = errors;

describe("error codes", () => {
  it("are exactly the 11 documented codes", () => {
    expect(Object.values(ERROR_CODES).sort()).toEqual(
      [
        "CONFLICT",
        "FORBIDDEN",
        "INSUFFICIENT_STOCK",
        "INTERNAL_ERROR",
        "INVALID_CREDENTIALS",
        "INVALID_CURRENT_PASSWORD",
        "NOT_FOUND",
        "PLAN_LIMIT_REACHED",
        "SUBSCRIPTION_READ_ONLY",
        "UNAUTHENTICATED",
        "VALIDATION_ERROR",
      ].sort(),
    );
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });
});

describe("AppError", () => {
  it("is an Error with code, status, message and details", () => {
    const err = new AppError("NOT_FOUND", "Data tidak ditemukan.");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Data tidak ditemukan.");
    expect(err.details).toBeNull();
  });

  it("rejects a code that is not in the set", () => {
    expect(() => new AppError("TEAPOT", "x")).toThrow(/unknown error code/i);
  });

  it("serializes to the public body and nothing else", () => {
    const err = new AppError("CONFLICT", "Kode sudah dipakai.", { a: 1 });

    expect(err.toBody()).toEqual({
      code: "CONFLICT",
      message: "Kode sudah dipakai.",
      details: { a: 1 },
    });
  });
});

describe("status mapping", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["INVALID_CURRENT_PASSWORD", 400],
    ["UNAUTHENTICATED", 401],
    ["INVALID_CREDENTIALS", 401],
    ["FORBIDDEN", 403],
    ["PLAN_LIMIT_REACHED", 403],
    ["SUBSCRIPTION_READ_ONLY", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["INSUFFICIENT_STOCK", 409],
    ["INTERNAL_ERROR", 500],
  ])("%s answers %i", (code, status) => {
    expect(new AppError(code, "x").status).toBe(status);
  });
});

describe("builders", () => {
  it("validationError carries the details list", () => {
    const details = [{ source: "body", path: "email", message: "Wajib diisi." }];
    const err = errors.validationError(details);

    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual(details);
    expect(err.message).toMatch(/\S/);
  });

  it("validationError accepts no details (a rule found later)", () => {
    expect(errors.validationError().details).toBeNull();
  });

  it.each([
    ["invalidCurrentPassword", "INVALID_CURRENT_PASSWORD"],
    ["unauthenticated", "UNAUTHENTICATED"],
    ["invalidCredentials", "INVALID_CREDENTIALS"],
    ["forbidden", "FORBIDDEN"],
    ["planLimitReached", "PLAN_LIMIT_REACHED"],
    ["subscriptionReadOnly", "SUBSCRIPTION_READ_ONLY"],
    ["notFound", "NOT_FOUND"],
    ["conflict", "CONFLICT"],
    ["internalError", "INTERNAL_ERROR"],
  ])("%s builds an AppError with code %s and an Indonesian default message", (name, code) => {
    const err = errors[name]();

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(/\S/);
  });

  it("conflict and notFound accept a custom message", () => {
    expect(errors.conflict("Kode gudang sudah dipakai.").message).toBe(
      "Kode gudang sudah dipakai.",
    );
    expect(errors.notFound("Gudang tidak ditemukan.").message).toBe(
      "Gudang tidak ditemukan.",
    );
  });

  it("insufficientStock carries the product ID in details", () => {
    const err = errors.insufficientStock("p-1");

    expect(err.code).toBe("INSUFFICIENT_STOCK");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ productId: "p-1" });
  });
});
