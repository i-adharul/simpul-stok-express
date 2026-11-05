const { z } = require("zod");
const { listQuerySchema } = require("./pagination.schema");

// IDs are lowercased first so "ABC..." and "abc..." are the same warehouse and product.
// A malformed ID in a body is a 400 (unlike one in a URL, which is a 404, rule 2).
const id = z.uuid().transform((value) => value.toLowerCase());

// An empty note (after trimming) is stored as null, like an empty address (docs/04).
const note = z
  .string()
  .trim()
  .max(255)
  .transform((value) => (value === "" ? null : value));

// BL11: a whole number from 1 to 1,000,000. z.number() refuses a string such as "5" and
// z.int() refuses 1.5, so the service only ever sees a safe integer in range.
const receiveSchema = z.object({
  warehouseId: id,
  productId: id,
  quantity: z.int().min(1).max(1000000),
  note: note.optional(),
});

// BL12. One flat object (so validate() makes it strict and rejects unknown keys, `organizationId`
// included), with the rule that depends on `mode` checked in superRefine: SET is the counted
// quantity (0 to 1,000,000), DELTA a non-zero difference (-1,000,000 to 1,000,000). `reason` is an
// enum, so it needs no minimum length.
const REASONS = ["STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"];

const adjustSchema = z
  .object({
    warehouseId: id,
    productId: id,
    mode: z.enum(["SET", "DELTA"]),
    value: z.int().min(-1000000).max(1000000),
    reason: z.enum(REASONS),
    note: note.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.mode === "SET" && body.value < 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Stok baru tidak boleh kurang dari 0." });
    }
    if (body.mode === "DELTA" && body.value === 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Selisih tidak boleh 0." });
    }
  });

// GET /api/stock. A malformed ID, an unknown status or paging out of range is a 400. An empty `q`
// (after trimming) means "no search". `includeArchived` is not part of this query (it is rejected
// as an unknown key): archived products are decided by their quantity, not by a flag.
const stockListQuerySchema = listQuerySchema.pick({ page: true, pageSize: true }).extend({
  warehouseId: id.optional(),
  productId: id.optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  status: z.enum(["OUT", "LOW", "OK"]).optional(),
});

module.exports = { receiveSchema, adjustSchema, stockListQuerySchema, REASONS };
