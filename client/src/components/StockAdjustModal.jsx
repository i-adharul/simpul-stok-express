import { useEffect, useRef, useState } from 'react'
import FormField from './FormField'
import SelectField from './SelectField'
import { GENERIC_ERROR, errorText, fieldErrorsFrom } from '../utils/apiError'
import { formatNumber } from '../utils/format'
import http from '../utils/http'
import { useStockOptions } from '../utils/useStockOptions'

const MAX_VALUE = 1_000_000
const MAX_NOTE = 255
const REASONS = { STOCK_OPNAME: 'Stok opname', DAMAGED: 'Rusak', LOST: 'Hilang', CORRECTION: 'Koreksi' }
const MODES = { DELTA: 'Selisih', SET: 'Jumlah akhir' }

// The quantity after the adjustment, or null while the value is not a valid whole number yet.
function projectedQuantity(mode, value, current) {
  const pattern = mode === 'SET' ? /^\d+$/ : /^-?\d+$/
  if (!pattern.test(value.trim()) || current === null) return null
  return mode === 'SET' ? Number(value) : current + Number(value)
}

// Same rules as the API (docs/04, BL12): SET 0 to 1,000,000; DELTA non-zero within +-1,000,000; the result
// never below 0 and never the same as now. The server validates again and stays the judge.
function validateAdjustment({ warehouseId, productId, mode, value, reason, note }, current) {
  const errors = {}
  if (!warehouseId) errors.warehouseId = 'Pilih gudang.'
  if (!productId) errors.productId = 'Pilih produk.'
  const text = value.trim()
  const pattern = mode === 'SET' ? /^\d+$/ : /^-?\d+$/
  if (!pattern.test(text) || Math.abs(Number(text)) > MAX_VALUE) {
    errors.value = mode === 'SET' ? 'Jumlah akhir harus bilangan bulat 0 sampai 1.000.000.' : 'Selisih harus bilangan bulat, bukan 0, antara -1.000.000 dan 1.000.000.'
  } else if (mode === 'DELTA' && Number(text) === 0) {
    errors.value = 'Selisih tidak boleh 0.'
  } else {
    const next = projectedQuantity(mode, value, current)
    if (next !== null && next < 0) errors.value = 'Stok tidak boleh kurang dari 0.'
    else if (next !== null && next > MAX_VALUE) errors.value = 'Stok akhir maksimal 1.000.000.'
    else if (next !== null && next === current) errors.value = 'Stok baru sama dengan stok saat ini.'
  }
  if (!REASONS[reason]) errors.reason = 'Pilih alasan penyesuaian.'
  if (note.trim().length > MAX_NOTE) errors.note = 'Catatan maksimal 255 karakter.'
  return errors
}

// A 400 maps by field path; anything else (403, 404, 409, network) is one message for the whole form.
function serverErrors(error) {
  if (error.response?.status === 400) {
    const byField = fieldErrorsFrom(error)
    if (Object.keys(byField).length > 0) return byField
  }
  if (!error.response) return { general: `${errorText(error)} Anda boleh mencoba lagi; penyesuaian tidak akan tercatat dua kali.` }
  return { general: errorText(error) ?? GENERIC_ERROR }
}

// P05. The current quantity of the chosen pair is read from GET /api/stock (no row means 0), so the popup
// can show the result before saving and refuse a negative one. `onSubmit(body, idempotencyKey)` does the
// request and rejects with the axios error. The key works as in P04: one per opening, new when a field changes.
export default function StockAdjustModal({ warehouseId = '', productId = '', onSubmit, onClose }) {
  const options = useStockOptions()
  const [values, setValues] = useState({ warehouseId, productId, mode: 'DELTA', value: '', reason: '', note: '' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  // { pair, quantity }: `pair` says which warehouse and product the quantity belongs to.
  const [stock, setStock] = useState({ pair: '', quantity: null })
  const idempotencyKey = useRef(crypto.randomUUID())
  const inFlight = useRef(false)
  const set = (field) => (event) => {
    idempotencyKey.current = crypto.randomUUID()
    setValues((v) => ({ ...v, [field]: event.target.value }))
  }

  const pair = values.warehouseId && values.productId ? `${values.warehouseId}|${values.productId}` : ''
  useEffect(() => {
    if (!pair) return undefined
    const controller = new AbortController()
    http
      .get('/api/stock', { params: { warehouseId: values.warehouseId, productId: values.productId }, signal: controller.signal })
      .then((res) => setStock({ pair, quantity: res.data.items[0]?.quantity ?? 0 }))
      .catch((err) => {
        if (!controller.signal.aborted) setErrors({ general: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [pair, values.warehouseId, values.productId])

  const current = pair && stock.pair === pair ? stock.quantity : null
  const next = projectedQuantity(values.mode, values.value, current)
  const negative = next !== null && next < 0
  const product = options.products.find((p) => p.id === values.productId)

  async function handleSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    const found = validateAdjustment(values, current)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    inFlight.current = true
    setSubmitting(true)
    try {
      await onSubmit(
        {
          warehouseId: values.warehouseId,
          productId: values.productId,
          mode: values.mode,
          value: Number(values.value),
          reason: values.reason,
          note: values.note.trim(),
        },
        idempotencyKey.current,
      )
    } catch (err) {
      setErrors(serverErrors(err))
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="adjust-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="adjust-title" className="text-lg font-semibold">
            Sesuaikan stok
          </h2>
          <p className="text-sm text-base-content/70">Ubah jumlah persediaan fisik di gudang ini.</p>
        </div>
        {options.error && (
          <p role="alert" className="text-sm font-medium text-error">
            {options.error}
          </p>
        )}
        <SelectField id="adjust-warehouse" label="Gudang" value={values.warehouseId} onChange={set('warehouseId')} error={errors.warehouseId} disabled={options.loading}>
          <option value="">{options.loading ? 'Memuat...' : 'Pilih gudang'}</option>
          {options.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} - {w.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="adjust-product" label="Produk" value={values.productId} onChange={set('productId')} error={errors.productId} disabled={options.loading}>
          <option value="">{options.loading ? 'Memuat...' : 'Pilih produk'}</option>
          {options.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} - {p.name}
            </option>
          ))}
        </SelectField>
        {pair && (
          <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-sm">
            Stok saat ini:{' '}
            <span className="font-semibold">{current === null ? 'memuat...' : `${formatNumber(current)} ${product?.unit ?? ''}`}</span>
          </div>
        )}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">Mode penyesuaian</legend>
          <div className="join w-full">
            {Object.entries(MODES).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`btn join-item flex-1 ${values.mode === mode ? 'btn-primary' : ''}`}
                aria-pressed={values.mode === mode}
                onClick={() => {
                  idempotencyKey.current = crypto.randomUUID()
                  setValues((v) => ({ ...v, mode, value: '' }))
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <FormField
          id="adjust-value"
          label={values.mode === 'SET' ? 'Jumlah akhir' : 'Jumlah selisih'}
          required
          inputMode="numeric"
          hint={values.mode === 'DELTA' ? 'Gunakan tanda minus (-) untuk pengurangan.' : undefined}
          value={values.value}
          onChange={set('value')}
          error={errors.value ?? (negative ? 'Stok tidak boleh kurang dari 0.' : undefined)}
        />
        {next !== null && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${negative ? 'border-error bg-error/10 text-error' : 'border-base-300 bg-base-200'}`}>
            Proyeksi stok baru: <span className="font-semibold">{formatNumber(next)} {product?.unit ?? ''}</span>
          </div>
        )}
        <SelectField id="adjust-reason" label="Alasan penyesuaian" value={values.reason} onChange={set('reason')} error={errors.reason}>
          <option value="">Pilih alasan</option>
          {Object.entries(REASONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <FormField id="adjust-note" label="Catatan (opsional)" multiline rows={2} maxLength={MAX_NOTE} value={values.note} onChange={set('note')} error={errors.note} />
        {errors.general && (
          <p role="alert" className="text-sm font-medium text-error">
            {errors.general}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || options.loading || negative}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Simpan penyesuaian'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
