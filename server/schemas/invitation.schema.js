const { z } = require("zod");
const { listQuerySchema } = require("./pagination.schema");

const MAX_WAREHOUSES = 200;

// BL05. The role of an invited person is only Warehouse Admin or Viewer: OWNER is not in the list,
// so it is a 400 (every organization has exactly one Owner, BL07). The email is trimmed and
// lowercase, like at login, because the table stores it lowercase (CHECK in the migration).
// Warehouse IDs are lowercased first so "ABC..." and "abc..." count as one, then duplicates are
// refused. A malformed ID in the body is a 400, unlike an ID in the URL (that one is a 404, rule 2).
const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).pipe(z.email()),
  role: z.enum(["WAREHOUSE_ADMIN", "VIEWER"]),
  warehouseIds: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .max(MAX_WAREHOUSES)
    .refine((ids) => new Set(ids).size === ids.length, { message: "ID gudang tidak boleh ganda." })
    .default([]),
});

// Numbered pages with a total (docs/04). `includeArchived` does not exist for invitations, so only
// page and pageSize are accepted and any other key is a 400.
const invitationListQuerySchema = listQuerySchema.pick({ page: true, pageSize: true });

// The ID of a URL is NOT checked as a UUID here: a malformed ID must be 404 like an unknown one
// (rule 2), and findOwned gives that answer. The schema only satisfies rule 4 (every write route
// has one) and refuses a missing value.
const invitationIdParamsSchema = z.object({ id: z.string() });

module.exports = {
  MAX_WAREHOUSES,
  createInvitationSchema,
  invitationListQuerySchema,
  invitationIdParamsSchema,
};
