// Pure helpers for S11. The server validates again (docs/04); these save a round trip and point at the field.
export const MAX_ITEMS = 50
export const MAX_QUANTITY = 1_000_000
export const MAX_NOTE = 255

let nextRowId = 1
// A row has its own id so that removing a row never shifts the state of the others (the product can still be empty).
export const newRow = (productId = '', quantity = '') => ({ rowId: nextRowId++, productId, quantity })

// `stock` maps productId -> { product, quantity } for the source warehouse. Returns
// { fromWarehouseId?, toWarehouseId?, note?, rows: { [rowId]: { productId?, quantity? } }, items? }.
export function validateTransfer({ fromWarehouseId, toWarehouseId, note, rows }, stock) {
  const errors = { rows: {} }
  if (!fromWarehouseId) errors.fromWarehouseId = 'Pilih gudang asal.'
  if (!toWarehouseId) errors.toWarehouseId = 'Pilih gudang tujuan.'
  else if (toWarehouseId === fromWarehouseId) errors.toWarehouseId = 'Gudang tujuan harus berbeda dari gudang asal.'
  if (note.trim().length > MAX_NOTE) errors.note = 'Catatan maksimal 255 karakter.'
  if (rows.length === 0) errors.items = 'Tambahkan minimal satu item.'

  const seen = new Set()
  for (const row of rows) {
    const rowErrors = {}
    if (!row.productId) rowErrors.productId = 'Pilih produk.'
    else if (seen.has(row.productId)) rowErrors.productId = 'Produk sudah ada di daftar.'
    else if (!stock[row.productId]) rowErrors.productId = 'Produk ini tidak punya stok di gudang asal.'
    seen.add(row.productId)
    const quantity = Number(row.quantity)
    if (!/^\d+$/.test(row.quantity.trim()) || quantity < 1 || quantity > MAX_QUANTITY) {
      rowErrors.quantity = 'Jumlah harus bilangan bulat 1 sampai 1.000.000.'
    } else if (row.productId && stock[row.productId] && quantity > stock[row.productId].quantity) {
      rowErrors.quantity = `Melebihi stok tersedia (${stock[row.productId].quantity.toLocaleString('id-ID')}).`
    }
    if (Object.keys(rowErrors).length > 0) errors.rows[row.rowId] = rowErrors
  }
  return errors
}

export const hasErrors = (errors) =>
  Object.keys(errors).some((key) => (key === 'rows' ? Object.keys(errors.rows).length > 0 : Boolean(errors[key])))

// The body of POST /api/stock/transfers. An empty note is left out.
export function buildBody({ fromWarehouseId, toWarehouseId, note, rows }) {
  const body = {
    fromWarehouseId,
    toWarehouseId,
    items: rows.map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })),
  }
  if (note.trim()) body.note = note.trim()
  return body
}
