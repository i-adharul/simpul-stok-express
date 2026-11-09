const { registerOrganizationSchema } = require("../schemas/auth.schema");
const {
  organizationNameSchema,
  organizationAddressSchema,
  slugSchema,
} = require("../schemas/organization.schema");
const validate = require("../middlewares/validate");

// Runs a schema through the real validate middleware, so unknown keys behave as in a route.
function run(schema, body) {
  const req = { params: {}, query: {}, headers: {}, body };
  let error;
  validate({ body: schema })(req, {}, (err) => {
    error = err;
  });
  return { error, valid: req.valid };
}
const paths = (error) => error.details.map((d) => d.path);

describe("organization field schemas", () => {
  it("copies the warehouse limits: name 1 to 100, address up to 255", () => {
    expect(organizationNameSchema.safeParse(" Toko Maju ").data).toBe("Toko Maju");
    expect(organizationNameSchema.safeParse("   ").success).toBe(false);
    expect(organizationNameSchema.safeParse("a".repeat(101)).success).toBe(false);
    expect(organizationAddressSchema.safeParse("   ").data).toBeNull();
    expect(organizationAddressSchema.safeParse("a".repeat(256)).success).toBe(false);
  });

  it.each(["abc", "toko123", "a".repeat(30)])("accepts the slug %s", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(["ab", "a".repeat(31), "Toko", "toko-maju", "toko maju", "toko_1", ""])(
    "rejects the slug %j",
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    },
  );
});

describe("registerOrganizationSchema", () => {
  const valid = {
    organizationName: "Toko Maju",
    slug: "tokomaju",
    name: "Budi",
    email: "Budi@Example.com ",
    password: "Gula-Kopi-2026",
  };
  const register = (body) => run(registerOrganizationSchema, body);

  it("trims and lowercases the email, and keeps the password as typed", () => {
    const { valid: out } = register({ ...valid, email: "  Budi@Example.COM ", password: " Gula-Kopi-2026 " });

    expect(out.body.email).toBe("budi@example.com");
    expect(out.body.password).toBe(" Gula-Kopi-2026 ");
  });

  it("rejects unknown keys, one line per key", () => {
    const { error } = register({ ...valid, organizationId: "x", status: "ACTIVE" });

    expect(paths(error)).toEqual(expect.arrayContaining(["organizationId", "status"]));
  });

  it.each([
    [{ slug: "Toko" }, "slug"],
    [{ slug: "ab" }, "slug"],
    [{ organizationName: " " }, "organizationName"],
    [{ name: "" }, "name"],
    [{ email: "not-an-email" }, "email"],
    [{ password: "short1" }, "password"],
    [{ password: "onlyletters" }, "password"],
    [{ password: "password123" }, "password"],
    [{ password: "budi@example.com" }, "password"],
  ])("rejects %j at %s", (patch, path) => {
    expect(paths(register({ ...valid, ...patch }).error)).toContain(path);
  });

  it("rejects a password equal to the part before the @", () => {
    const { error } = register({ ...valid, email: "budisantoso1@example.com", password: "BudiSantoso1" });

    expect(error.details).toEqual([
      { source: "body", path: "password", message: "Password tidak boleh sama dengan email." },
    ]);
  });

  it.each(["organizationName", "slug", "name", "email", "password"])("requires %s", (key) => {
    const { [key]: _omit, ...rest } = valid;

    expect(paths(register(rest).error)).toEqual([key]);
  });
});

describe("acceptInviteSchema", () => {
  const { acceptInviteSchema } = require("../schemas/auth.schema");
  const accept = (body) => run(acceptInviteSchema, body);
  const valid = { token: "t".repeat(43), name: " Sari ", password: "Gula-Kopi-2026" };

  it("trims the name, keeps the token and the password as they are", () => {
    const { valid: out } = accept({ ...valid, password: " Gula-Kopi-2026 " });

    expect(out.body).toEqual({ token: "t".repeat(43), name: "Sari", password: " Gula-Kopi-2026 " });
  });

  it("leaves the password rules to the service (the invited email is not known here)", () => {
    expect(accept({ ...valid, password: "short" }).error).toBeUndefined();
  });

  it.each(["token", "name", "password"])("requires %s", (key) => {
    const { [key]: _omit, ...rest } = valid;

    expect(paths(accept(rest).error)).toEqual([key]);
  });

  it.each([
    [{ name: "   " }, "name"],
    [{ name: "a".repeat(101) }, "name"],
    [{ token: "" }, "token"],
    [{ token: "t".repeat(201) }, "token"],
    [{ password: "a".repeat(129) }, "password"],
    [{ token: 5 }, "token"],
  ])("rejects %j at %s", (patch, path) => {
    expect(paths(accept({ ...valid, ...patch }).error)).toContain(path);
  });

  it("rejects unknown keys such as email, role or organizationId", () => {
    expect(paths(accept({ ...valid, email: "a@b.id", role: "OWNER", organizationId: "x" }).error)).toEqual(
      expect.arrayContaining(["email", "role", "organizationId"]),
    );
  });
});
