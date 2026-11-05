const { z } = require("zod");

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

module.exports = { receiveSchema };
