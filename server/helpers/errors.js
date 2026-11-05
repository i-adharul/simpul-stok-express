// The complete set of error codes the API can return (docs/04_API_Spec.md, "Error codes").
const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  SUBSCRIPTION_READ_ONLY: "SUBSCRIPTION_READ_ONLY",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

// One status per code, so a controller never picks a status by hand.
const STATUS_BY_CODE = Object.freeze({
  VALIDATION_ERROR: 400,
  INVALID_CURRENT_PASSWORD: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  PLAN_LIMIT_REACHED: 403,
  SUBSCRIPTION_READ_ONLY: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  INTERNAL_ERROR: 500,
});

class AppError extends Error {
  constructor(code, message, details = null) {
    if (!Object.hasOwn(STATUS_BY_CODE, code)) {
      throw new Error(`Unknown error code: ${code}`);
    }
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  // The only shape that leaves the server: no stack, no cause (BL29).
  toBody() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

// Builders keep the Indonesian default messages in one place.
const validationError = (details = null, message = "Data yang dikirim tidak valid.") =>
  new AppError(ERROR_CODES.VALIDATION_ERROR, message, details);

const invalidCurrentPassword = () =>
  new AppError(ERROR_CODES.INVALID_CURRENT_PASSWORD, "Password saat ini salah.");

const unauthenticated = () =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, "Sesi tidak valid. Silakan masuk lagi.");

const invalidCredentials = () =>
  new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Email atau password salah.");

const forbidden = (message = "Anda tidak memiliki akses untuk tindakan ini.") =>
  new AppError(ERROR_CODES.FORBIDDEN, message);

const planLimitReached = (message = "Batas paket Anda sudah tercapai.", details = null) =>
  new AppError(ERROR_CODES.PLAN_LIMIT_REACHED, message, details);

const subscriptionReadOnly = (
  message = "Langganan Anda sedang dalam mode baca saja.",
) => new AppError(ERROR_CODES.SUBSCRIPTION_READ_ONLY, message);

const notFound = (message = "Data tidak ditemukan.") =>
  new AppError(ERROR_CODES.NOT_FOUND, message);

const conflict = (message = "Data bentrok dengan kondisi saat ini.", details = null) =>
  new AppError(ERROR_CODES.CONFLICT, message, details);

const insufficientStock = (productId) =>
  new AppError(ERROR_CODES.INSUFFICIENT_STOCK, "Stok tidak cukup.", { productId });

const internalError = () =>
  new AppError(ERROR_CODES.INTERNAL_ERROR, "Terjadi kesalahan pada server.");

module.exports = {
  AppError,
  ERROR_CODES,
  STATUS_BY_CODE,
  validationError,
  invalidCurrentPassword,
  unauthenticated,
  invalidCredentials,
  forbidden,
  planLimitReached,
  subscriptionReadOnly,
  notFound,
  conflict,
  insufficientStock,
  internalError,
};
