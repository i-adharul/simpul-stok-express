import { useState } from 'react'
import PlanLimitNotice from './PlanLimitNotice'
import { GENERIC_ERROR, errorText, isPlanLimit } from '../utils/apiError'

const COPY = {
  gudang: {
    archive: 'Gudang yang diarsipkan tidak dapat lagi menerima atau mengeluarkan stok.',
    restore: 'Gudang akan aktif kembali dan dapat dipakai untuk stok dan mutasi.',
  },
  produk: {
    archive:
      'Produk yang diarsipkan tidak dapat dipakai untuk penerimaan, mutasi, atau impor. Stok yang masih ada tetap dapat disesuaikan.',
    restore: 'Produk akan aktif kembali dan dapat dipakai untuk penerimaan dan mutasi.',
  },
}

// P03. `kind` is "gudang" or "produk"; `restore` flips the wording. `onConfirm()` does the PATCH and
// rejects with the axios error. A refusal from the server (for example a warehouse that still has stock,
// 409) turns the popup into the "blocked" variant of the design: the server message and a single button.
export default function ArchiveConfirmModal({ kind, name, restore = false, onConfirm, onClose }) {
  const [submitting, setSubmitting] = useState(false)
  const [blocked, setBlocked] = useState(null)

  async function confirm() {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } catch (err) {
      setBlocked({ text: errorText(err) ?? GENERIC_ERROR, planLimit: isPlanLimit(err) })
      setSubmitting(false)
    }
  }

  const verb = restore ? 'Pulihkan' : 'Arsipkan'
  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="archive-title">
      <div className="modal-box max-w-md space-y-3">
        {blocked ? (
          <>
            <h2 id="archive-title" className="text-lg font-semibold">
              Tidak dapat {restore ? 'dipulihkan' : 'diarsipkan'}
            </h2>
            {blocked.planLimit ? (
              <PlanLimitNotice message={blocked.text} />
            ) : (
              <p role="alert" className="text-sm text-base-content/70">
                {blocked.text}
              </p>
            )}
            <div className="modal-action">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Mengerti
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="archive-title" className="text-lg font-semibold">
              {verb} {kind} {name}?
            </h2>
            <p className="text-sm text-base-content/70">{COPY[kind][restore ? 'restore' : 'archive']}</p>
            <div className="modal-action">
              <button type="button" className="btn" onClick={onClose} disabled={submitting}>
                Batal
              </button>
              <button type="button" className={`btn ${restore ? 'btn-primary' : 'btn-error'}`} onClick={confirm} disabled={submitting}>
                {submitting ? <span className="loading loading-spinner loading-sm" /> : verb}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}
