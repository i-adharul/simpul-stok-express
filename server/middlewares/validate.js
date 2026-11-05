const { validationError } = require("../helpers/errors");

// "header" (singular) is the name docs/04 gives to the source of header problems.
const SOURCES = [
  { key: "params", source: "params", read: (req) => req.params },
  { key: "query", source: "query", read: (req) => req.query },
  { key: "headers", source: "header", read: (req) => req.headers },
  { key: "body", source: "body", read: (req) => req.body ?? {} },
];

// A plain z.object() silently drops unknown keys; here they must be an error (a client sending
// `organizationId` must be told no, not ignored). Headers are exempt: a request always carries
// headers the schema does not know about.
const strict = (schema) =>
  schema.def.type === "object" && schema.def.catchall === undefined
    ? schema.strict()
    : schema;

const toDetails = (source, issues) =>
  issues.map((issue) => ({
    source,
    path: issue.path.join("."),
    message: issue.message,
  }));

// validate({ params, query, headers, body }) -> middleware. On success the parsed values (with
// coercion and defaults applied) are in req.valid.<key>; controllers read them from there and
// never from req.body or req.query. req.query is a read-only getter in Express 5, so it cannot
// be overwritten with the parsed value.
function validate(schemas) {
  const active = SOURCES.filter(({ key }) => schemas[key]);
  if (active.length === 0) {
    throw new Error("validate() needs at least one schema");
  }

  return function validateRequest(req, res, next) {
    const valid = {};
    const details = [];

    for (const { key, source, read } of active) {
      const schema = key === "headers" ? schemas[key] : strict(schemas[key]);
      const result = schema.safeParse(read(req));
      if (result.success) valid[key] = result.data;
      else details.push(...toDetails(source, result.error.issues));
    }

    if (details.length > 0) return next(validationError(details));
    req.valid = valid;
    return next();
  };
}

module.exports = validate;
