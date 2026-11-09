const { z } = require("zod");

// Lengths are copied from `name` and `address` in warehouse.schema.js (no new numbers): the
// database columns are the same size (docs/03, Organization).
const organizationNameSchema = z.string().trim().min(1).max(100);

// An empty address is stored as null, like a warehouse address.
const organizationAddressSchema = z
  .string()
  .trim()
  .max(255)
  .transform((value) => (value === "" ? null : value));

// 3 to 30 lowercase letters and digits, the same rule as the CHECK in the Organizations table.
// Not lowercased for the caller: "Toko" is a mistake to report, not something to fix silently.
const slugSchema = z
  .string()
  .regex(/^[a-z0-9]{3,30}$/, "Slug harus 3 sampai 30 huruf kecil atau angka.");

// PATCH /api/organization (E7-03): only name and address, at least one. The slug, status, id and
// organizationId are not fields here, so validate() rejects them as unknown keys (400). An empty
// address clears it (stored null), like a warehouse.
const updateOrganizationSchema = z
  .object({
    name: organizationNameSchema.optional(),
    address: organizationAddressSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Minimal satu field wajib diisi.",
    // Not when another issue was found already (an unknown key): one clear message is enough.
    when: (payload) => payload.issues.length === 0,
  });

module.exports = {
  organizationNameSchema,
  organizationAddressSchema,
  slugSchema,
  updateOrganizationSchema,
};
