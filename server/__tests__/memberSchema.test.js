const { memberListQuerySchema, updateMemberSchema } = require("../schemas/member.schema");
const validate = require("../middlewares/validate");

function run(schema, body) {
  const req = { params: {}, query: {}, headers: {}, body };
  let error;
  validate({ body: schema })(req, {}, (err) => {
    error = err;
  });
  return { error, valid: req.valid };
}
const update = (body) => run(updateMemberSchema, body);
const paths = (error) => error.details.map((d) => d.path);
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("updateMemberSchema", () => {
  it("accepts each field alone and all together", () => {
    expect(update({ role: "VIEWER" }).error).toBeUndefined();
    expect(update({ isActive: false }).error).toBeUndefined();
    expect(update({ warehouseIds: [] }).error).toBeUndefined();
    expect(update({ role: "WAREHOUSE_ADMIN", isActive: false, warehouseIds: [W1.toUpperCase(), W2] }).valid.body).toEqual({
      role: "WAREHOUSE_ADMIN",
      isActive: false,
      warehouseIds: [W1, W2],
    });
  });

  it("rejects an empty body with one clear message", () => {
    const { error } = update({});

    expect(error.details).toEqual([expect.objectContaining({ source: "body", message: "Minimal satu field wajib diisi." })]);
  });

  it.each(["OWNER", "PLATFORM_ADMIN", "viewer", ""])("rejects the role %j", (role) => {
    expect(paths(update({ role }).error)).toEqual(["role"]);
  });

  it.each([true, "false", 0, null])("rejects isActive %j (reactivation goes through an invitation)", (isActive) => {
    expect(paths(update({ isActive }).error)).toEqual(["isActive"]);
  });

  it.each([
    [{ warehouseIds: ["not-a-uuid"] }, "warehouseIds.0"],
    [{ warehouseIds: [W1, W1.toUpperCase()] }, "warehouseIds"],
    [{ warehouseIds: "x" }, "warehouseIds"],
  ])("rejects %j at %s", (body, path) => {
    expect(paths(update(body).error)).toContain(path);
  });

  it("accepts 200 warehouses and rejects 201", () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    expect(update({ warehouseIds: ids(200) }).error).toBeUndefined();
    expect(update({ warehouseIds: ids(201) }).error).toBeDefined();
  });

  it("rejects other keys such as email, name, organizationId, passwordHash and id", () => {
    const { error } = update({ role: "VIEWER", email: "x@y.id", name: "x", organizationId: W1, passwordHash: "x", id: W1 });

    expect(paths(error)).toEqual(expect.arrayContaining(["email", "name", "organizationId", "passwordHash", "id"]));
  });
});

describe("memberListQuerySchema", () => {
  it("keeps page and pageSize only", () => {
    expect(memberListQuerySchema.safeParse({}).data).toEqual({ page: 1, pageSize: 20 });
  });
});
