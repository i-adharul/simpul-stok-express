const { z } = require("zod");
const { listQuerySchema } = require("./pagination.schema");

// Every whitespace character is removed (the database CHECK allows none), then the value is made
// uppercase, and only then is the length measured: the stored value is the one that was checked.
const sku = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().min(1).max(50));

const name = z.string().trim().min(1).max(100);

const UNITS = ["bks", "ktk", "pcs", "btl", "jrg", "pak"];
const unit = z.enum(UNITS);

// A whole number from 0 to 1,000,000,000 (the database CHECK has the same range).
const minStock = z.number().int().min(0).max(1_000_000_000);

const createProductSchema = z.object({
  sku,
  name,
  unit,
  minStock: minStock.default(0),
});

// No default here: a field that is not sent must stay as it is. At least one field is required.
const updateProductSchema = z
  .object({
    sku: sku.optional(),
    name: name.optional(),
    unit: unit.optional(),
    minStock: minStock.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Minimal satu field wajib diisi.",
    // Not when another issue was found already (an unknown key): one clear message is enough.
    when: (payload) => payload.issues.length === 0,
  });

module.exports = {
  UNITS,
  createProductSchema,
  updateProductSchema,
  productListQuerySchema: listQuerySchema,
};
