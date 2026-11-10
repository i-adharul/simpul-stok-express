const { z } = require("zod");
const { MAX_WAREHOUSES } = require("./invitation.schema");
const { listQuerySchema } = require("./pagination.schema");

// Numbered pages with a total (docs/04). `includeArchived` does not exist for members, so only page
// and pageSize are accepted and any other key is a 400.
const memberListQuerySchema = listQuerySchema.pick({ page: true, pageSize: true });

// BL07. At least one field, no other key. `role` is only Warehouse Admin or Viewer (OWNER is a 400: every
// organization has exactly one Owner). `isActive` accepts only `false`: reactivation goes through a
// new invitation (BL06), so `true` is a 400. `warehouseIds` is the NEW full assignment (replaced as a
// whole); IDs are lowercased, then duplicates are refused. A malformed ID in the body is a 400, unlike
// an ID in the URL (404, rule 2).
const updateMemberSchema = z
  .object({
    role: z.enum(["WAREHOUSE_ADMIN", "VIEWER"]).optional(),
    isActive: z.literal(false).optional(),
    warehouseIds: z
      .array(z.uuid().transform((value) => value.toLowerCase()))
      .max(MAX_WAREHOUSES)
      .refine((ids) => new Set(ids).size === ids.length, { message: "ID gudang tidak boleh ganda." })
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Minimal satu field wajib diisi.",
    // Not when another issue was found already (an unknown key): one clear message is enough.
    when: (payload) => payload.issues.length === 0,
  });

// BL07. The ID is only checked to be present: a malformed one is a 404 from findOwned, not a 400 (rule 2).
// The reset link has no body at all; the empty schema (unknown keys are rejected by validate()) only
// satisfies rule 4 and refuses a client that sends fields it thinks matter.
const memberIdParamsSchema = z.object({ id: z.string() });
const resetLinkBodySchema = z.object({});

module.exports = { memberListQuerySchema, updateMemberSchema, memberIdParamsSchema, resetLinkBodySchema };
