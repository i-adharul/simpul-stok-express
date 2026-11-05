// Dates are stored in UTC and shown in WIB (Asia/Jakarta); numbers use Indonesian formatting.
const TIME_ZONE = 'Asia/Jakarta'

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const timeFormat = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const numberFormat = new Intl.NumberFormat('id-ID')

// Accepts an ISO string or a Date; returns '' for a missing or invalid value.
function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value) {
  const date = toDate(value)
  return date ? dateFormat.format(date) : ''
}

export function formatDateTime(value) {
  const date = toDate(value)
  return date ? `${dateFormat.format(date)} ${timeFormat.format(date)} WIB` : ''
}

// 1234567.5 -> "1.234.567,5"
export function formatNumber(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== '' ? numberFormat.format(Number(value)) : ''
}

export function formatRupiah(value) {
  const text = formatNumber(value)
  return text ? `Rp${text}` : ''
}
