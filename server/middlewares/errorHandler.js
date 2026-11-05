const jwt = require("jsonwebtoken");
const { UniqueConstraintError, ValidationError } = require("sequelize");
const { logger } = require("../helpers/logger");
const {
  AppError,
  conflict,
  internalError,
  notFound,
  unauthenticated,
  validationError,
} = require("../helpers/errors");

// Sequelize messages are English and may name columns; only the path is kept and the text is ours.
const fromSequelizeValidation = (err) =>
  validationError(
    err.errors.map((item) => ({
      source: "body",
      path: item.path ?? "",
      message: "Nilai tidak valid.",
    })),
  );

// body-parser (express.json) tags its own failures with type "entity.*", e.g. "entity.parse.failed".
const isBodyParserError = (err) =>
  typeof err.type === "string" && err.type.startsWith("entity.");

// Turns anything thrown into an AppError. Everything unknown becomes INTERNAL_ERROR, so the
// cause (SQL, stack, library message) can never reach the response body (BL29).
function toAppError(err) {
  if (err instanceof AppError) return err;
  // UniqueConstraintError extends ValidationError, so it must be checked first.
  if (err instanceof UniqueConstraintError)
    return conflict("Data sudah ada.");
  if (err instanceof ValidationError) return fromSequelizeValidation(err);
  // TokenExpiredError and NotBeforeError extend JsonWebTokenError.
  if (err instanceof jwt.JsonWebTokenError) return unauthenticated();
  if (isBodyParserError(err))
    return validationError(null, "Isi permintaan tidak valid.");
  return internalError();
}

// Express 5 calls this for errors thrown in sync handlers and rejected promises of async ones.
// The four parameters are what tell Express it is an error handler: do not remove `next`.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const appError = toAppError(err);
  // Only unexpected failures are logged as errors; the log keeps name and message, never the stack.
  if (appError.status >= 500 && !(err instanceof AppError)) {
    logger.error("unhandled error", { requestId: req.id, error: err });
  }
  return res.status(appError.status).json(appError.toBody());
}

// Express does not treat "no route matched" as an error, so this is a normal middleware that
// must stay below every route.
function notFoundHandler(req, res) {
  res.status(404).json(notFound().toBody());
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
module.exports.notFoundHandler = notFoundHandler;
module.exports.toAppError = toAppError;
