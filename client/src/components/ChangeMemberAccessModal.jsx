import { useState } from 'react'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'

const ROLES = [
  { value: 'WAREHOUSE_ADMIN', label: 'Admin Gudang' },
  { value: 'VIEWER', label: 'Viewer' },
]

// P09. `member` is one row of GET /api/members; `warehouses` are the active warehouses (checkboxes).
// PATCH sends the role and the WHOLE new assignment: the API replaces it in one transaction.
// The change applies on the member's next request (role and status are read from the database each time).
export default function ChangeMemberAccessModal({ member, warehouses, onSaved, onClose }) {
  const [role, setRole] = useState(member.role)
  const [warehouseIds, setWarehouseIds] = useState(member.warehouses.map((w) => w.id))
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const toggle = (id) => setWarehouseIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await http.patch(`/api/members/${member.id}`, { role, warehouseIds })
      onSaved()
    } catch (err) {
      setError(errorText(err) ?? GENERIC_ERROR)
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="access-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 id="access-title" className="text-lg font-semibold">
            Ubah akses {member.name}
          </h2>
          <p className="text-sm text-base-content/70">{member.email}</p>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">Peran akses</legend>
          <div className="join w-full">
            {ROLES.map((r) => (
              <label key={r.value} className={`btn join-item flex-1 ${role === r.value ? 'btn-primary btn-soft' : ''}`}>
                <input type="radio" name="member-role" className="hidden" checked={role === r.value} disabled={member.isDemo} onChange={() => setRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
          {member.isDemo && <p className="text-xs text-base-content/70">Peran akun demo tidak dapat diubah. Akses gudang tetap bisa diatur.</p>}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">Akses lokasi gudang</legend>
          {warehouses.length === 0 ? (
            <p className="text-sm text-base-content/70">Belum ada gudang aktif.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300">
              {warehouses.map((w) => (
                <li key={w.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={warehouseIds.includes(w.id)} onChange={() => toggle(w.id)} />
                    {w.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-base-content/60">Pilihan ini menggantikan seluruh penugasan gudang sebelumnya.</p>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
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
