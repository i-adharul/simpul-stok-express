const env = require("../config/env");
const { notFound } = require("../helpers/errors");

// The door of the demo (BL31, ADR 0016). With DEMO_MODE off the route answers like any unknown
// route, with the same 404 body. It sits BEFORE validate, so a request with a bad body also gets the
// 404 and a server without a demo does not reveal that the route exists. `env` is read on every
// request, not once at load, so the switch is judged where it is used.
function demoMode(req, res, next) {
  if (!env.DEMO_MODE) return next(notFound());
  return next();
}

module.exports = demoMode;
