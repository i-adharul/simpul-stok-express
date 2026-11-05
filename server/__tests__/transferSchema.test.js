const { transferSchema } = require("../schemas/transfer.schema");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const valid = { fromWarehouseId: A, toWarehouseId: B, items: [{ productId: P1, quantity: 1 }] };

const parse = (body) => transferSchema.safeParse(body);
const paths = (body) => {
  const result = parse(body);
  return result.success ? null : result.error.issues.map((issue) => issue.path.join("."));
};

describe("transferSchema: valid input", () => {
  it("accepts the smallest and the largest valid transfer", () => {
    expect(parse(valid).success).toBe(true);
    const fifty = Array.from({ length: 50 }, (_, i) => ({ productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1000000 }));
    expect(parse({ ...valid, items: fifty }).success).toBe(true);
  });

  it("lowercases the IDs, trims the note and stores an empty note as null", () => {
    const upper = parse({ fromWarehouseId: A.toUpperCase(), toWarehouseId: B, items: [{ productId: P1.toUpperCase(), quantity: 2 }], note: "  kirim  " });
    expect(upper.data).toEqual({ fromWarehouseId: A, toWarehouseId: B, items: [{ productId: P1, quantity: 2 }], note: "kirim" });
    expect(parse({ ...valid, note: "   " }).data.note).toBeNull();
    expect(parse(valid).data.note).toBeUndefined();
  });

  it("accepts a note of exactly 255 characters", () => {
    expect(parse({ ...valid, note: "x".repeat(255) }).success).toBe(true);
  });
});

describe("transferSchema: invalid input", () => {
  it("refuses a source equal to the destination, pointing at the destination", () => {
    expect(paths({ ...valid, toWarehouseId: A })).toEqual(["toWarehouseId"]);
  });

  it("refuses 0 items and more than 50 items", () => {
    expect(paths({ ...valid, items: [] })).toEqual(["items"]);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => ({ productId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, quantity: 1 }));
    expect(paths({ ...valid, items: fiftyOne })).toEqual(["items"]);
  });

  it("refuses a product that appears twice, pointing at the second one (ignoring ID case)", () => {
    const items = [{ productId: P1, quantity: 1 }, { productId: P2, quantity: 1 }, { productId: P1.toUpperCase(), quantity: 3 }];
    expect(paths({ ...valid, items })).toEqual(["items.2.productId"]);
  });

  it("refuses a quantity that is not a whole number from 1 to 1,000,000", () => {
    for (const quantity of [0, -1, 1.5, 1000001, "5", null, undefined]) {
      expect(paths({ ...valid, items: [{ productId: P1, quantity }] })).toEqual(["items.0.quantity"]);
    }
  });

  it("refuses a note over 255 characters", () => {
    expect(paths({ ...valid, note: "x".repeat(256) })).toEqual(["note"]);
  });

  it("refuses a malformed ID", () => {
    expect(paths({ ...valid, fromWarehouseId: "abc" })).toEqual(["fromWarehouseId"]);
    expect(paths({ ...valid, items: [{ productId: "abc", quantity: 1 }] })).toEqual(["items.0.productId"]);
  });

  it("refuses an unknown field inside an item", () => {
    expect(parse({ ...valid, items: [{ productId: P1, quantity: 1, organizationId: A }] }).success).toBe(false);
  });

  it("refuses missing fields and items that are not an array", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ ...valid, items: { productId: P1, quantity: 1 } }).success).toBe(false);
  });
});
