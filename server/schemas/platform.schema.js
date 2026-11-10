const { listQuerySchema } = require("./pagination.schema");

// Numbered pages with a total (docs/04): page (default 1) and pageSize (1 to 100, default 20). The
// platform list has no `includeArchived`, so any other key is a 400.
const platformOrganizationListQuerySchema = listQuerySchema.pick({ page: true, pageSize: true });

module.exports = { platformOrganizationListQuerySchema };
