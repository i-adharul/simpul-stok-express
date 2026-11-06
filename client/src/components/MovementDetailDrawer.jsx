import { useEffect, useState } from 'react'
import ErrorState from './ErrorState'
import LoadingSkeleton from './LoadingSkeleton'
import { ROLE_LABELS } from '../constants/navigation'
import { ADJUST_REASONS } from '../constants/stock'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatDateTime, formatNumber } from '../utils/format'
import http from '../utils/http'

function Field({ label, children }) {
  return (
    <div className="space-y-1 border-b border-base-300 py-3 last:border-0">
      <div className="text-xs font-semibold uppercase text-base-content/60">{label}</div>
      <div>{children}</div>
    </div>
  )
}

function Detail({ movement }) {
  const { product, warehouse, createdBy, transfer } = movement
  const delta = movement.quantityDelta
  return (
    <div>
      <div className="rounded-xl border border-base-300 p-4">
        <div className="text-xs font-semibold uppercase text-base-content/60">Jumlah pergerakan</div>
        <div className={`text-3xl font-bold ${delta < 0 ? 'text-error' : 'text-success'}`}>
          {delta > 0 && '+'}
          {formatNumber(delta)} <span className="text-base font-normal">{product.unit}</span>
        </div>
      </div>
      <Field label="Produk">
        <div className="font-medium">{product.name}</div>
        <div className="text-sm text-base-content/60">
          {product.sku} • Satuan: {product.unit}
        </div>
      </Field>
      <Field label={transfer ? 'Gudang asal / lokasi' : 'Gudang'}>
        <div className="font-medium">{warehouse.name}</div>
        <div className="text-sm text-base-content/60">{warehouse.code}</div>
        {transfer && (
          <div className="text-sm">
            {transfer.fromWarehouse.name} → {transfer.toWarehouse.name}
          </div>
        )}
      </Field>
      <Field label="Waktu pencatatan">{formatDateTime(movement.createdAt)}</Field>
      <Field label="Dibuat oleh">
        {createdBy ? (
          <span className="font-medium">
            {createdBy.name} <span className="badge badge-soft badge-sm">{ROLE_LABELS[createdBy.role] ?? createdBy.role}</span>
          </span>
        ) : (
          <span className="text-base-content/60">Sistem</span>
        )}
      </Field>
      {movement.reason && <Field label="Alasan">{ADJUST_REASONS[movement.reason] ?? movement.reason}</Field>}
      <Field label="Catatan">{movement.note ?? <span className="text-base-content/60">—</span>}</Field>
      {transfer && <Field label="Referensi mutasi">{transfer.code}</Field>}
    </div>
  )
}

// P13, a side drawer. GET /api/stock/movements/:id adds the product, warehouse, creator and transfer to the
// list row. A 404 (missing, foreign or out-of-reach movement look the same, docs/04) says it was not found.
export default function MovementDetailDrawer({ id, typeLabel, onClose }) {
  const [state, setState] = useState({ id: null, movement: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/stock/movements/${id}`, { signal: controller.signal })
      .then(({ data }) => setState({ id, movement: data, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        const message = err.response?.status === 404 ? 'Pergerakan tidak ditemukan.' : (errorText(err) ?? GENERIC_ERROR)
        setState({ id, movement: null, error: message })
      })
    return () => controller.abort()
  }, [id, attempt])

  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loaded = state.id === id
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="movement-title"
        className="flex h-full w-full max-w-md flex-col bg-base-100 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-base-300 p-5">
          <div className="space-y-1">
            <h2 id="movement-title" className="text-lg font-semibold">
              Detail pergerakan
            </h2>
            {typeLabel && <span className="badge badge-soft badge-primary">{typeLabel}</span>}
          </div>
          <button type="button" className="btn btn-ghost btn-sm btn-circle" aria-label="Tutup" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {!loaded && <LoadingSkeleton rows={5} />}
          {loaded && state.error && (
            <ErrorState message={state.error} onRetry={state.error === 'Pergerakan tidak ditemukan.' ? undefined : () => setAttempt((n) => n + 1)} />
          )}
          {loaded && state.movement && <Detail movement={state.movement} />}
        </div>
        <div className="space-y-2 border-t border-base-300 p-5">
          <button type="button" className="btn w-full" onClick={onClose}>
            Tutup
          </button>
          <p className="text-center text-xs text-base-content/60">Data riwayat tercatat permanen dan tidak dapat diubah.</p>
        </div>
      </aside>
    </div>
  )
}
