const { z } = require("zod");
const { listQuerySchema } = require("./pagination.schema");

// Uppercase first, then the length check, so the stored value is the one that was measured
// (an uppercase letter can be longer than the original). The database CHECK expects a trimmed,
// uppercase code (migration create-warehouse).
const code = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(1).max(20));

const name = z.string().trim().min(1).max(100);

// An empty address is stored as null (docs/04). To clear an address, PATCH it with "".
const address = z
  .string()
  .trim()
  .max(255)
  .transform((value) => (value === "" ? null : value));

const createWarehouseSchema = z.object({
  code,
  name,
  address: address.optional(),
});

// At least one field, otherwise the request changes nothing. The same field rules as create.
const updateWarehouseSchema = z
  .object({
    code: code.optional(),
    name: name.optional(),
    address: address.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Minimal satu field wajib diisi.",
    // Not when another issue was found already (an unknown key): one clear message is enough.
    when: (payload) => payload.issues.length === 0,
  });

module.exports = {
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseListQuerySchema: listQuerySchema,
};
