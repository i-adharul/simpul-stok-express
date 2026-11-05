const { z } = require("zod");

const MAX_USERS = 200;

// The new full set of users of a warehouse. IDs are lowercased first so "ABC..." and "abc..."
// count as the same user, then duplicates are refused (docs/04: UUIDs, no duplicates, at most 200).
// A malformed ID is a 400 here, unlike an ID in the URL (that one is a 404, rule 2).
const replaceMembersSchema = z.object({
  userIds: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .max(MAX_USERS)
    .refine((ids) => new Set(ids).size === ids.length, { message: "ID pengguna tidak boleh ganda." }),
});

module.exports = { MAX_USERS, replaceMembersSchema };
