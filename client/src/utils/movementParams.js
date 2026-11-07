import { wibDayStart, wibNextDayStart } from './format'

// Turns the filters of a history screen into the query of GET /api/stock/movements. `from` and `to` are
// calendar days in WIB (YYYY-MM-DD); the API takes instants with an offset, `from` inclusive and `to` exclusive.
export function buildMovementParams(filters) {
  const params = {}
  for (const key of ['productId', 'warehouseId', 'type']) if (filters[key]) params[key] = filters[key]
  if (filters.from) params.from = wibDayStart(filters.from)
  if (filters.to) params.to = wibNextDayStart(filters.to)
  return params
}
