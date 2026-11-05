const bcrypt = require("bcryptjs");

// CLAUDE.md / docs/05: bcryptjs with cost 12.
const COST = 12;
// bcrypt reads only the first 72 bytes: without the guard below, "<72 bytes>zzz" would be accepted
// as the password "<72 bytes>". See helpers/password.js, which refuses such passwords when they are set.
const MAX_BYTES = 72;

const hashPassword = (plain) => bcrypt.hash(plain, COST);

// Never throws: anything that cannot match (not a string, too long, a damaged hash) is just `false`,
// so the caller has one failure path and cannot leak the reason.
async function comparePassword(plain, hash) {
  if (typeof plain !== "string" || Buffer.byteLength(plain, "utf8") > MAX_BYTES) {
    return false;
  }
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, comparePassword, COST };
