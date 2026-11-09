const { listQuerySchema } = require("./pagination.schema");

// Numbered pages with a total (docs/04). `includeArchived` does not exist for members, so only page
// and pageSize are accepted and any other key is a 400.
const memberListQuerySchema = listQuerySchema.pick({ page: true, pageSize: true });

module.exports = { memberListQuerySchema };
