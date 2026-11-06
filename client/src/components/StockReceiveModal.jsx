import { useEffect, useRef, useState } from 'react'
import FormField from './FormField'
import { GENERIC_ERROR, errorText, fieldErrorsFrom } from '../utils/apiError'
import http from '../utils/http'

const MAX_QUANTITY = 1_000_000
const MAX_NOTE = 255

// Same limits as the API (docs/04: quantity a whole number 1 to 1,000,000, note at most 255 characters
// after trimming). The server validates again; this only saves a round trip and points at the field.
function validateReceipt({ warehouseId, productId, quantity, note }) {
  const errors = {}
  if (!warehouseId) errors.warehouseId = 'Pilih gudang.'
  if (!productId) errors.productId = 'Pilih produk.'
  if (!/^\d+$/.test(quantity.trim()) || Number(quantity) < 1 || Number(quantity) > MAX_QUANTITY) {
    errors.quantity = 'Jumlah harus bilangan bulat 1 sampai 1.000.000.'
  }
  if (note.trim().length > MAX_NOTE) errors.note = 'Catatan maksimal 255 karakter.'
  return errors
}

// A 400 maps by field path; anything else (403, 404, 409, network) is one message for the whole form.
function serverErrors(error) {
  if (error.response?.status === 400) {
    const byField = fieldErrorsFrom(error)
    if (Object.keys(byField).length > 0) return byField
  }
  return { general: errorText(error) ?? GENERIC_ERROR }
}

function SelectField({ id, label, error, children, ...props }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label} <span className="text-error">*</span>
      </label>
      <select id={id} className={`select w-full ${error ? 'select-error' : ''}`} aria-invalid={Boolean(error)} {...props}>
        {children}
      </select>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  )
}

// P04. The warehouse list already holds only the warehouses the caller may use (docs/04), and the
// product list only active products. `warehouseId` and `productId` preselect the fields when the popup
// opens from S06 or S08. `onSubmit(values, idempotencyKey)` does the request and rejects with the axios error.
//
// Idempotency (BL14): the popup is mounted each time it opens, so `useRef(crypto.randomUUID())` gives one
// new key per opening. A retry of the same form (after a network error or a double click) reuses it, so
// the server applies the receipt once. Editing a field means a different intent, so it gets a new key.
export default function StockReceiveModal({ warehouseId = '', productId = '', onSubmit, onClose }) {
  const [options, setOptions] = useState({ warehouses: [], products: [], loading: true, error: null })
  const [values, setValues] = useState({ warehouseId, productId, quantity: '', note: '' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const idempotencyKey = useRef(crypto.randomUUID())
  const set = (field) => (event) => {
    idempotencyKey.current = crypto.randomUUID()
    setValues((v) => ({ ...v, [field]: event.target.value }))
  }

  useEffect(() => {
    const controller = new AbortController()
    const config = { params: { pageSize: 100 }, signal: controller.signal }
    Promise.all([http.get('/api/warehouses', config), http.get('/api/products', config)])
      .then(([w, p]) => setOptions({ warehouses: w.data.items, products: p.data.items, loading: false, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setOptions((o) => ({ ...o, loading: false, error: errorText(err) ?? GENERIC_ERROR }))
      })
    return () => controller.abort()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const found = validateReceipt(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      await onSubmit(
        {
          warehouseId: values.warehouseId,
          productId: values.productId,
          quantity: Number(values.quantity),
          note: values.note.trim(),
        },
        idempotencyKey.current,
      )
    } catch (err) {
      setErrors(serverErrors(err))
      setSubmitting(false)
    }
  }

  const unit = options.products.find((p) => p.id === values.productId)?.unit

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="receive-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="receive-title" className="text-lg font-semibold">
            Terima barang
          </h2>
          <p className="text-sm text-base-content/70">Catat penambahan persediaan barang masuk langsung ke gudang.</p>
        </div>
        {options.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {options.error}
          </p>
        )}
        <SelectField id="receive-warehouse" label="Gudang" value={values.warehouseId} onChange={set('warehouseId')} error={errors.warehouseId} disabled={options.loading}>
          <option value="">{options.loading ? 'Memuat...' : 'Pilih gudang'}</option>
          {options.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} - {w.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="receive-product" label="Produk" value={values.productId} onChange={set('productId')} error={errors.productId} disabled={options.loading}>
          <option value="">{options.loading ? 'Memuat...' : 'Pilih produk'}</option>
          {options.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} - {p.name}
            </option>
          ))}
        </SelectField>
        <FormField
          id="receive-quantity"
          label={unit ? `Jumlah diterima (${unit})` : 'Jumlah diterima'}
          required
          inputMode="numeric"
          value={values.quantity}
          onChange={set('quantity')}
          error={errors.quantity}
        />
        <FormField id="receive-note" label="Catatan (opsional)" multiline rows={2} maxLength={MAX_NOTE} value={values.note} onChange={set('note')} error={errors.note} />
        {errors.general && (
          <p role="alert" className="text-sm font-medium text-error">
            {errors.general}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || options.loading}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Simpan penerimaan'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
