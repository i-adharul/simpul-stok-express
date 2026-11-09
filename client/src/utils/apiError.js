// Turns a failed request into text for the user. Returns undefined for a 5xx so the caller shows its
// generic message and never an internal detail (docs: BL29).
export function errorText(error) {
  if (!error.response) return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.'
  if (error.response.status >= 500) return undefined
  return error.response.data?.message
}

export const GENERIC_ERROR = 'Terjadi kesalahan. Silakan coba lagi.'

// Maps VALIDATION_ERROR details ([{ source, path, message }]) to { fieldName: message }.
export function fieldErrorsFrom(error) {
  const details = error.response?.data?.details
  if (!Array.isArray(details)) return {}
  const result = {}
  for (const d of details) if (d.path && !result[d.path]) result[d.path] = d.message
  return result
}

// 403 PLAN_LIMIT_REACHED (BL20) has its own presentation; a plain 403 FORBIDDEN is something else.
export function isPlanLimit(error) {
  return error.response?.status === 403 && error.response.data?.code === 'PLAN_LIMIT_REACHED'
}
