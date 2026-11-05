const { z } = require("zod");

// Query values arrive as strings. Only plain digits are accepted ("2", not "2.5", "1e1" or " 2"),
// then the range is checked, so every bad value is a 400 with a Zod message.
const whole = (min, max) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

// The query shared by every paged list (docs/04): page, pageSize and includeArchived.
// `includeArchived` is only read here; it is honoured for the Owner by the controller.
const listQuerySchema = z.object({
  page: whole(1, 1_000_000).default(1),
  pageSize: whole(1, 100).default(20),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
});

module.exports = { listQuerySchema };
