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

module.exports = { organizationNameSchema, organizationAddressSchema, slugSchema };
