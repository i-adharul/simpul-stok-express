// Pure helpers for the S02 sign-up form (BL04). The server is the judge; these checks only give
// quick inline feedback, with the same limits as schemas/auth.schema.js.

// "Kopi Senja & Co" -> "kopisenjaco": lower-case letters and digits only, cut to 30 characters.
export function suggestSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30)
}

export function validateOrganization({ organizationName, slug }) {
  const errors = {}
  if (!organizationName.trim()) errors.organizationName = 'Nama organisasi wajib diisi.'
  else if (organizationName.trim().length > 100) errors.organizationName = 'Nama organisasi maksimal 100 karakter.'
  if (!/^[a-z0-9]{3,30}$/.test(slug)) errors.slug = 'Slug 3 sampai 30 karakter, hanya huruf kecil dan angka.'
  return errors
}

export const PASSWORD_HINT = 'Minimal 8 karakter, mengandung huruf dan angka.'
const PASSWORD_ERROR = 'Password harus minimal 8 karakter dan mengandung huruf serta angka.'

function validateName(name) {
  if (!name.trim()) return 'Nama lengkap wajib diisi.'
  if (name.trim().length > 100) return 'Nama lengkap maksimal 100 karakter.'
  return undefined
}

// Password rule of BL01 and its confirmation. "Terlalu umum" is only known to the server.
export function validatePasswordPair({ password, passwordConfirm }) {
  const errors = {}
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) errors.password = PASSWORD_ERROR
  else if (passwordConfirm !== password) errors.passwordConfirm = 'Konfirmasi password tidak sama.'
  return errors
}

export function validateOwner({ name, email, password, passwordConfirm }) {
  const errors = validatePasswordPair({ password, passwordConfirm })
  const nameError = validateName(name)
  if (nameError) errors.name = nameError
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Format email tidak valid.'
  return errors
}

// S03 (accept invitation): the email comes from the invitation, so only name and password are checked.
export function validateAccept({ name, password, passwordConfirm }) {
  const errors = validatePasswordPair({ password, passwordConfirm })
  const nameError = validateName(name)
  if (nameError) errors.name = nameError
  return errors
}
