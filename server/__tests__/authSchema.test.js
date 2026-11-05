const { loginSchema } = require("../schemas/auth.schema");

const parse = (body) => loginSchema.safeParse(body);

describe("loginSchema", () => {
  it("trims and lowercases the email and leaves the password alone", () => {
    const result = parse({ email: "  Budi@Example.COM ", password: "  Rahasia 1  " });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ email: "budi@example.com", password: "  Rahasia 1  " });
  });

  it("only checks the shape: an email without @ passes", () => {
    expect(parse({ email: "budi", password: "x" }).success).toBe(true);
  });

  it("accepts the limits: email of 254 and password of 128 characters", () => {
    expect(parse({ email: "a".repeat(254), password: "p".repeat(128) }).success).toBe(true);
  });

  it.each([
    ["no body fields", {}],
    ["missing email", { password: "x" }],
    ["missing password", { email: "a@b.id" }],
    ["empty email", { email: "", password: "x" }],
    ["email of only spaces", { email: "   ", password: "x" }],
    ["email over 254", { email: "a".repeat(255), password: "x" }],
    ["empty password", { email: "a@b.id", password: "" }],
    ["password over 128", { email: "a@b.id", password: "p".repeat(129) }],
    ["email is a number", { email: 5, password: "x" }],
    ["password is null", { email: "a@b.id", password: null }],
    ["password is an object", { email: "a@b.id", password: { $ne: "" } }],
    ["body is an array", [{ email: "a@b.id", password: "x" }]],
    ["body is a string", "text"],
  ])("rejects %s", (_name, body) => {
    expect(parse(body).success).toBe(false);
  });
});
