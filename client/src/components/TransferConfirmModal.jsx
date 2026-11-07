import { useRef, useState } from 'react'
import { formatNumber } from '../utils/format'
import { transferErrorMessage } from '../utils/transferErrors'

// P11. `items` are { productId, sku, name, unit, quantity }. `onSend(idempotencyKey)` does the request and
// rejects with the axios error; `onFailure(error)` lets S11 refresh what the refusal makes stale.
//
// Idempotency (BL14): the popup is mounted each time it opens, so useRef(crypto.randomUUID()) is one new key per
// opening. Pressing "Kirim mutasi" again (a double click, or a retry after a lost answer) reuses it, so the
// server makes the transfer once. Closing with "Periksa lagi" and sending later is a new opening, a new key.
export default function TransferConfirmModal({ from, to, items, onSend, onFailure, onClose }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const idempotencyKey = useRef(crypto.randomUUID())
  // A ref, not only state: it blocks a second click that arrives before React has re-rendered.
  const inFlight = useRef(false)
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0)

  async function send() {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onSend(idempotencyKey.current)
    } catch (err) {
      setError(transferErrorMessage(err, items))
      onFailure?.(err)
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="transfer-confirm-title">
      <div className="modal-box max-w-xl space-y-4">
        <div>
          <h2 id="transfer-confirm-title" className="text-lg font-semibold">
            Tinjau mutasi
          </h2>
          <p className="text-sm text-base-content/70">Pastikan rincian mutasi sudah sesuai sebelum dikirim.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-base-200 p-3">
          <div>
            <div className="text-xs text-base-content/60">Gudang asal</div>
            <div className="font-semibold">{from.name}</div>
          </div>
          <div className="text-center">
            <span aria-hidden="true">→</span>
            <div className="badge badge-soft badge-primary badge-sm">Mutasi langsung</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-base-content/60">Gudang tujuan</div>
            <div className="font-semibold">{to.name}</div>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Produk</th>
                <th className="text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <td>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-base-content/60">SKU: {item.sku}</div>
                  </td>
                  <td className="text-right font-semibold">
                    {formatNumber(item.quantity)} {item.unit}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total perpindahan</th>
                <th className="text-right">
                  {formatNumber(totalUnits)} unit ({formatNumber(items.length)} produk)
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="rounded-lg bg-base-200 p-3 text-sm text-base-content/70">Mutasi tidak dapat dibatalkan. Koreksi dibuat sebagai mutasi baru.</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Periksa lagi
          </button>
          <button type="button" className="btn btn-primary" onClick={send} disabled={submitting}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Kirim mutasi'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
