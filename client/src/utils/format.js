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

// A calendar day typed by the user ("2026-11-05") is a day in WIB, which is UTC+7 all year (no daylight
// saving). The history API takes instants with an offset: `from` inclusive, `to` exclusive.
export function wibDayStart(day) {
  return `${day}T00:00:00+07:00`
}

// The start of the day after `day`, so a "to" date typed by the user includes that whole day.
export function wibNextDayStart(day) {
  const [y, m, d] = day.split('-').map(Number)
  return wibDayStart(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10))
}

const longDateFormat = new Intl.DateTimeFormat('id-ID', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' })

// "Kamis, 24 Oktober 2024" (WIB)
export function formatLongDate(value) {
  const date = toDate(value)
  return date ? longDateFormat.format(date) : ''
}

// Greeting by the hour in WIB, not the hour of the browser's own time zone.
export function greetingFor(value) {
  const date = toDate(value)
  if (!date) return 'Selamat datang'
  const hour = Number(hourFormat.format(date))
  if (hour < 11) return 'Selamat pagi'
  if (hour < 15) return 'Selamat siang'
  if (hour < 18) return 'Selamat sore'
  return 'Selamat malam'
}
