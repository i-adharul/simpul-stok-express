const { z } = require("zod");
const { validationError } = require("../helpers/errors");
const { toDetails } = require("../helpers/validationDetails");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The object key is the header's name, so a problem is reported with that exact path (docs/04).
// Missing gives "Wajib diisi.", a wrong shape gives "Format tidak valid." (the global messages).
const headerSchema = z.object({
  "Idempotency-Key": z.string().regex(UUID).transform((value) => value.toLowerCase()),
});

// Stock writes carry a client-made UUID (BL14). Placement on a route: after authentication, the
// role check and subscriptionGuard, before validate, so a caller who may not act gets 403 whatever
// the header says and the header is judged before the body (docs/04, "Idempotency (BL14)").
// The key is kept in lower case, so the same UUID in upper case is the same key.
// A repeated header arrives as "a, b" in Node, which is not a UUID, so it is refused too.
function idempotencyKey(req, res, next) {
  const result = headerSchema.safeParse({ "Idempotency-Key": req.get("Idempotency-Key") });
  if (!result.success) return next(validationError(toDetails("header", result.error.issues)));
  req.idempotencyKey = result.data["Idempotency-Key"];
  return next();
}

// A marker for the static tests, like `isValidate` and `isSubscriptionGuard`.
idempotencyKey.isIdempotencyKey = true;

module.exports = idempotencyKey;
