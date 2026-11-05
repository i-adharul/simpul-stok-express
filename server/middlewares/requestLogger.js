const crypto = require("crypto");
const { logger: defaultLogger } = require("../helpers/logger");

const levelFor = (status) =>
  status >= 500 ? "error" : status >= 400 ? "warn" : "info";

// The route pattern ("/api/invitations/:token") says which endpoint ran without printing the
// secret in the URL. When no route matched (a 404) only the path is logged, never the query string.
function pathOf(req) {
  return req.route ? `${req.baseUrl}${req.route.path}` : req.path;
}

// Logs one line per request when the response is finished. The body is never read here, so
// passwords and tokens in a request body cannot reach the log (docs/05, security).
function createRequestLogger(logger = defaultLogger) {
  return function requestLogger(req, res, next) {
    // Always created here: an ID sent by the client could be used to forge log lines.
    req.id = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger[levelFor(res.statusCode)]("request", {
        requestId: req.id,
        method: req.method,
        path: pathOf(req),
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}

module.exports = createRequestLogger();
module.exports.createRequestLogger = createRequestLogger;
