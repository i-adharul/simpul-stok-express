const {
  createInvitationSchema,
  invitationListQuerySchema,
  invitationIdParamsSchema,
} = require("../schemas/invitation.schema");
const validate = require("../middlewares/validate");

function run(parts) {
  const schemas = Object.fromEntries(Object.entries(parts).map(([key, [schema]]) => [key, schema]));
  const req = { params: {}, query: {}, headers: {}, body: {} };
  for (const [key, [, value]] of Object.entries(parts)) req[key] = value;
  let error;
  validate(schemas)(req, {}, (err) => {
    error = err;
  });
  return { error, valid: req.valid };
}
const create = (body) => run({ body: [createInvitationSchema, body] });
const paths = (error) => error.details.map((d) => d.path);
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("createInvitationSchema", () => {
  it("trims and lowercases the email and keeps role and warehouses", () => {
    const { valid } = create({ email: "  Sari@Example.COM ", role: "VIEWER", warehouseIds: [W1.toUpperCase(), W2] });

    expect(valid.body).toEqual({ email: "sari@example.com", role: "VIEWER", warehouseIds: [W1, W2] });
  });

  it("allows an empty list and no list at all (empty)", () => {
    expect(create({ email: "a@b.id", role: "WAREHOUSE_ADMIN", warehouseIds: [] }).valid.body.warehouseIds).toEqual([]);
    expect(create({ email: "a@b.id", role: "WAREHOUSE_ADMIN" }).valid.body.warehouseIds).toEqual([]);
  });

  it("rejects the role OWNER and any other role with 400", () => {
    for (const role of ["OWNER", "PLATFORM_ADMIN", "owner", ""]) {
      expect(paths(create({ email: "a@b.id", role }).error)).toEqual(["role"]);
    }
  });

  it.each([
    [{ role: "VIEWER" }, "email"],
    [{ email: "not-an-email", role: "VIEWER" }, "email"],
    [{ email: "a@b.id" }, "role"],
    [{ email: "a@b.id", role: "VIEWER", warehouseIds: ["not-a-uuid"] }, "warehouseIds.0"],
    [{ email: "a@b.id", role: "VIEWER", warehouseIds: [W1, W1.toUpperCase()] }, "warehouseIds"],
  ])("rejects %j at %s", (body, path) => {
    expect(paths(create(body).error)).toContain(path);
  });

  it("accepts 200 warehouses and rejects 201", () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    expect(create({ email: "a@b.id", role: "VIEWER", warehouseIds: ids(200) }).error).toBeUndefined();
    expect(create({ email: "a@b.id", role: "VIEWER", warehouseIds: ids(201) }).error).toBeDefined();
  });

  it("rejects unknown keys such as organizationId, tokenHash or expiresAt", () => {
    const { error } = create({ email: "a@b.id", role: "VIEWER", organizationId: W1, tokenHash: "x", expiresAt: "x" });

    expect(paths(error)).toEqual(expect.arrayContaining(["organizationId", "tokenHash", "expiresAt"]));
  });
});

describe("invitationListQuerySchema", () => {
  const list = (query) => run({ query: [invitationListQuerySchema, query] });

  it("defaults to page 1 and 20 per page", () => {
    expect(list({}).valid.query).toEqual({ page: 1, pageSize: 20 });
  });

  it("reads numbers and rejects other keys and bad values", () => {
    expect(list({ page: "2", pageSize: "50" }).valid.query).toEqual({ page: 2, pageSize: 50 });
    expect(paths(list({ includeArchived: "true" }).error)).toEqual(["includeArchived"]);
    expect(paths(list({ pageSize: "101" }).error)).toEqual(["pageSize"]);
  });
});

describe("invitationIdParamsSchema", () => {
  it("accepts any text (a malformed ID is a 404 later, not a 400)", () => {
    expect(run({ params: [invitationIdParamsSchema, { id: "abc" }] }).error).toBeUndefined();
  });
});
