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
