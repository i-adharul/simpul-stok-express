// One password policy for every flow that sets a password: sign-up, accepting an invitation,
// reset and change (docs/02, Design decisions: Account). Pure functions, no I/O.

const MIN_LENGTH = 8;
// bcrypt only reads the first 72 bytes, so a longer password would be silently cut. The limit is
// counted in bytes (UTF-8), which equals 72 characters for ASCII.
const MAX_BYTES = 72;

// Fixed list of 38 entries, compared in lower case. It is code, not a file: nothing is read at run
// time and the list cannot drift without a visible diff.
const COMMON_PASSWORDS = Object.freeze([
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
  "87654321",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssw0rd",
  "qwerty123",
  "qwerty1234",
  "qwertyuiop",
  "abc12345",
  "abcd1234",
  "abc123456",
  "admin123",
  "admin1234",
  "welcome1",
  "welcome123",
  "letmein123",
  "iloveyou1",
  "iloveyou123",
  "monkey123",
  "dragon123",
  "sayang123",
  "indonesia123",
  "bismillah123",
  "rahasia123",
  "kata sandi123",
  "katasandi123",
  "123qweasd",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "q1w2e3r4",
  "zaq12wsx",
]);

const REASONS = Object.freeze({
  TOO_SHORT: "TOO_SHORT",
  TOO_LONG: "TOO_LONG",
  NEEDS_LETTER_AND_DIGIT: "NEEDS_LETTER_AND_DIGIT",
  SAME_AS_EMAIL: "SAME_AS_EMAIL",
  COMMON: "COMMON",
});

// Messages are the ones in docs/02 ("Password rule messages") or close to them; shown to users.
const MESSAGES = Object.freeze({
  TOO_SHORT: "Password harus minimal 8 karakter dan mengandung huruf serta angka.",
  TOO_LONG: "Password maksimal 72 karakter.",
  NEEDS_LETTER_AND_DIGIT: "Password harus minimal 8 karakter dan mengandung huruf serta angka.",
  SAME_AS_EMAIL: "Password tidak boleh sama dengan email.",
  COMMON: "Password terlalu umum.",
});

const hasLetter = (value) => /\p{L}/u.test(value);
const hasDigit = (value) => /[0-9]/.test(value);

function sameAsEmail(password, email) {
  if (typeof email !== "string" || email.trim() === "") return false;
  const lower = password.toLowerCase();
  const address = email.trim().toLowerCase();
  const localPart = address.split("@")[0];
  return lower === address || lower === localPart;
}

// Returns the first rule the password breaks, or null when it is acceptable.
function findProblem(password, email) {
  if (typeof password !== "string" || password.length < MIN_LENGTH)
    return REASONS.TOO_SHORT;
  if (Buffer.byteLength(password, "utf8") > MAX_BYTES) return REASONS.TOO_LONG;
  if (!hasLetter(password) || !hasDigit(password))
    return REASONS.NEEDS_LETTER_AND_DIGIT;
  if (sameAsEmail(password, email)) return REASONS.SAME_AS_EMAIL;
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) return REASONS.COMMON;
  return null;
}

// { valid: true } or { valid: false, reason, message }. `email` is optional (the login form has
// none); when given, the password may not equal it or the part before the "@".
function validatePassword(password, { email } = {}) {
  const reason = findProblem(password, email);
  if (reason === null) return { valid: true };
  return { valid: false, reason, message: MESSAGES[reason] };
}

module.exports = {
  validatePassword,
  COMMON_PASSWORDS,
  REASONS,
  MIN_LENGTH,
  MAX_BYTES,
};
