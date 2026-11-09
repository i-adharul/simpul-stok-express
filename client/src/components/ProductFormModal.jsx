import { useState } from 'react'
import FormField from './FormField'
import PlanLimitNotice from './PlanLimitNotice'
import { UNIT_LABELS } from '../constants/units'
import { GENERIC_ERROR, errorText, fieldErrorsFrom, isPlanLimit } from '../utils/apiError'

const MAX_MIN_STOCK = 1_000_000_000

// Same limits as the API (docs/04: sku 1 to 50 without whitespace, name 1 to 100, a unit from the list,
// minStock a whole number 0 to 1,000,000,000). The server validates again.
function validateProduct({ sku, name, unit, minStock }) {
  const errors = {}
  const cleanSku = sku.replace(/\s+/g, '')
  if (!cleanSku) errors.sku = 'SKU wajib diisi.'
  else if (cleanSku.length > 50) errors.sku = 'SKU maksimal 50 karakter.'
  if (!name.trim()) errors.name = 'Nama produk wajib diisi.'
  else if (name.trim().length > 100) errors.name = 'Nama produk maksimal 100 karakter.'
  if (!UNIT_LABELS[unit]) errors.unit = 'Pilih satuan.'
  if (!/^\d+$/.test(minStock.trim()) || Number(minStock) > MAX_MIN_STOCK) {
    errors.minStock = 'Batas minimum harus bilangan bulat 0 sampai 1.000.000.000.'
  }
  return errors
}

// 409 "SKU sudah dipakai." belongs under the SKU field; a 400 maps by field path.
function serverErrors(error) {
  const status = error.response?.status
  if (isPlanLimit(error)) return { planLimit: error.response.data.message }
  if (status === 409) return { sku: error.response.data.message }
  if (status === 400) {
    const byField = fieldErrorsFrom(error)
    if (Object.keys(byField).length > 0) return byField
  }
  return { general: errorText(error) ?? GENERIC_ERROR }
}

// P02. `product` is null to create, or the row to edit. `onSubmit(values)` does the request and rejects
// with the axios error so it can be shown next to the field.
export default function ProductFormModal({ product, onSubmit, onClose }) {
  const editing = Boolean(product)
  const [values, setValues] = useState({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    unit: product?.unit ?? 'pcs',
    minStock: String(product?.minStock ?? 0),
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const set = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const found = validateProduct(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      await onSubmit({
        sku: values.sku.replace(/\s+/g, ''),
        name: values.name.trim(),
        unit: values.unit,
        minStock: Number(values.minStock),
      })
    } catch (err) {
      setErrors(serverErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="product-form-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="product-form-title" className="text-lg font-semibold">
            {editing ? 'Ubah produk' : 'Tambah produk'}
          </h2>
          <p className="text-sm text-base-content/70">
            {editing ? 'Perbarui data produk.' : 'Daftarkan SKU baru ke dalam katalog produk organisasi.'}
          </p>
        </div>
        <FormField id="product-sku" label="SKU" required maxLength={60} hint="Kode unik pengenal produk." value={values.sku} onChange={set('sku')} error={errors.sku} />
        <FormField id="product-name" label="Nama produk" required maxLength={100} value={values.name} onChange={set('name')} error={errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="product-unit" className="text-sm font-semibold">
              Satuan <span className="text-error">*</span>
            </label>
            <select id="product-unit" className="select w-full" value={values.unit} onChange={set('unit')}>
              {Object.entries(UNIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.unit && <p role="alert" className="text-sm font-medium text-error">{errors.unit}</p>}
          </div>
          <FormField id="product-min-stock" label="Batas stok minimum" required inputMode="numeric" value={values.minStock} onChange={set('minStock')} error={errors.minStock} />
        </div>
        <p className="text-xs text-base-content/60">Peringatan muncul jika stok di bawah angka ini.</p>
        {errors.planLimit && <PlanLimitNotice message={errors.planLimit} />}
        {errors.general && (
          <p role="alert" className="text-sm font-medium text-error">
            {errors.general}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Simpan'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
