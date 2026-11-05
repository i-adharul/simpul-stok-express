const { z } = require("zod");
const { toDetails } = require("../helpers/validationDetails");

const detailsOf = (schema, data, source = "body") => {
  const result = schema.safeParse(data);
  expect(result.success).toBe(false);
  return toDetails(source, result.error.issues);
};

describe("toDetails", () => {
  it("returns [{ source, path, message }] and nothing else", () => {
    const details = detailsOf(z.object({ name: z.string() }), {});

    expect(details).toEqual([{ source: "body", path: "name", message: expect.any(String) }]);
  });

  it("writes nested paths with dots and array positions", () => {
    const schema = z.object({ items: z.array(z.object({ qty: z.number() })) });
    const details = detailsOf(schema, { items: [{ qty: "x" }] });

    expect(details[0].path).toBe("items.0.qty");
  });

  it("uses an empty path for a problem with the whole value", () => {
    const details = detailsOf(z.object({}), "text");

    expect(details[0].path).toBe("");
  });

  it("reports each unknown key on its own line with its own path", () => {
    const details = detailsOf(z.strictObject({ a: z.string() }), { a: "x", role: 1, org: 2 });

    expect(details.map((d) => d.path).sort()).toEqual(["org", "role"]);
    expect(details.every((d) => d.source === "body")).toBe(true);
  });

  it("keeps the source it is given", () => {
    expect(detailsOf(z.object({ a: z.string() }), {}, "query")[0].source).toBe("query");
  });
});

describe("messages are Indonesian", () => {
  const messageOf = (schema, data) => detailsOf(schema, data)[0].message;

  it("missing field", () => {
    expect(messageOf(z.object({ a: z.string() }), {})).toBe("Wajib diisi.");
  });

  it("wrong type", () => {
    expect(messageOf(z.object({ a: z.string() }), { a: 5 })).toBe("Tipe data tidak valid.");
  });

  it("string too short and too long", () => {
    expect(messageOf(z.object({ a: z.string().min(3) }), { a: "x" })).toBe("Minimal 3 karakter.");
    expect(messageOf(z.object({ a: z.string().max(2) }), { a: "xxx" })).toBe("Maksimal 2 karakter.");
  });

  it("number below minimum and above maximum", () => {
    expect(messageOf(z.object({ a: z.number().min(1) }), { a: 0 })).toBe("Minimal 1.");
    expect(messageOf(z.object({ a: z.number().max(5) }), { a: 9 })).toBe("Maksimal 5.");
  });

  it("bad format and bad enum value", () => {
    expect(messageOf(z.object({ a: z.email() }), { a: "x" })).toBe("Format tidak valid.");
    expect(messageOf(z.object({ a: z.enum(["x", "y"]) }), { a: "z" })).toBe("Nilai tidak diizinkan.");
  });

  it("unknown key", () => {
    expect(messageOf(z.strictObject({}), { a: 1 })).toBe("Field tidak dikenal.");
  });

  it("a message written in the schema wins", () => {
    expect(messageOf(z.object({ a: z.string().min(3, "Terlalu pendek.") }), { a: "x" })).toBe("Terlalu pendek.");
  });
});
