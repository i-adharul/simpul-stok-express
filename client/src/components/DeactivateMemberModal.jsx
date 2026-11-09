import { useState } from 'react'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'

// P10. PATCH { isActive: false }. The member's next request returns 401, so they lose access at once.
// Reactivation has no button: the Owner invites the same email again. The Owner can never be deactivated
// (the API answers 409), which also protects the last Owner; that answer is shown as the message.
export default function DeactivateMemberModal({ member, onDone, onClose }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function confirm() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await http.patch(`/api/members/${member.id}`, { isActive: false })
      onDone()
    } catch (err) {
      setError(errorText(err) ?? GENERIC_ERROR)
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="deactivate-title">
      <div className="modal-box max-w-md space-y-3">
        <h2 id="deactivate-title" className="text-lg font-semibold">
          Nonaktifkan {member.name}?
        </h2>
        <p className="text-sm text-base-content/70">
          Anggota ini langsung tidak bisa masuk atau memakai sesi yang sedang berjalan. Untuk mengaktifkan kembali, undang email yang sama lagi. Owner tidak dapat dinonaktifkan, sehingga organisasi selalu punya satu Owner.
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Batal
          </button>
          <button type="button" className="btn btn-error" onClick={confirm} disabled={submitting}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Nonaktifkan'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
