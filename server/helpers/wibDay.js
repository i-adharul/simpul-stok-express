// WIB (Asia/Jakarta) is UTC+7 all year, with no daylight saving, so the calendar day of WIB is a
// fixed shift of UTC. Dates stay in UTC in the database (rule 15); this only finds the day's bounds.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The WIB calendar day that contains `now`, as a half-open range: `from` (inclusive) is 00:00 WIB,
// `to` (exclusive) is 00:00 WIB of the next day. Use `>= from` and `< to`.
function wibDayRange(now = new Date()) {
  const shifted = now.getTime() + WIB_OFFSET_MS;
  const startShifted = shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS);
  const from = new Date(startShifted - WIB_OFFSET_MS);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

module.exports = { wibDayRange };
