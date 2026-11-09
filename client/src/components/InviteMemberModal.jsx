import { useState } from 'react'
import FormField from './FormField'
import { GENERIC_ERROR, errorText, fieldErrorsFrom } from '../utils/apiError'
import http from '../utils/http'

const ROLES = [
  { value: 'WAREHOUSE_ADMIN', label: 'Admin Gudang', help: 'Dapat mencatat mutasi, penyesuaian, dan menerima stok pada gudang yang ditugaskan.' },
  { value: 'VIEWER', label: 'Viewer', help: 'Hanya dapat melihat stok dan riwayat pada gudang yang ditugaskan.' },
]

function validate({ email, role }) {
  const errors = {}
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Format email tidak valid.'
  if (!role) errors.role = 'Pilih peran anggota.'
  return errors
}

// A 409 or 400 names a field in details; anything else (for example PLAN_LIMIT_REACHED) is shown as text.
function serverErrors(error) {
  const byField = fieldErrorsFrom(error)
  if (Object.keys(byField).length > 0) return byField
  return { general: errorText(error) ?? GENERIC_ERROR }
}

// P07. `warehouses` is the list of active warehouses (checkboxes). `onCreated({ invitation, token })`
// runs after the API answered 201; the raw token exists only in that answer (P08 shows it once).
export default function InviteMemberModal({ warehouses, onCreated, onClose }) {
  const [values, setValues] = useState({ email: '', role: 'WAREHOUSE_ADMIN', warehouseIds: [] })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const toggleWarehouse = (id) =>
    setValues((current) => ({
      ...current,
      warehouseIds: current.warehouseIds.includes(id) ? current.warehouseIds.filter((x) => x !== id) : [...current.warehouseIds, id],
    }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      const { data } = await http.post('/api/invitations', { email: values.email.trim(), role: values.role, warehouseIds: values.warehouseIds })
      onCreated(data)
    } catch (error) {
      setErrors(serverErrors(error))
      setSubmitting(false)
    }
  }

  const role = ROLES.find((r) => r.value === values.role)

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="invite-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="invite-title" className="text-lg font-semibold">
            Undang anggota
          </h2>
          <p className="text-sm text-base-content/70">Buat tautan undangan untuk bergabung ke organisasi Anda.</p>
        </div>
        <FormField id="invite-email" label="Email anggota" required type="email" maxLength={254} hint="Tautan undangan dibuat untuk alamat email ini." value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} error={errors.email} />
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">
            Peran akses <span className="text-error">*</span>
          </legend>
          <div className="join w-full">
            {ROLES.map((r) => (
              <label key={r.value} className={`btn join-item flex-1 ${values.role === r.value ? 'btn-primary btn-soft' : ''}`}>
                <input type="radio" name="invite-role" className="hidden" checked={values.role === r.value} onChange={() => setValues((v) => ({ ...v, role: r.value }))} />
                {r.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-base-content/60">{role.help}</p>
          {errors.role && <p role="alert" className="text-sm font-medium text-error">{errors.role}</p>}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold">Akses lokasi gudang</legend>
          {warehouses.length === 0 ? (
            <p className="text-sm text-base-content/70">Belum ada gudang aktif. Anggota dapat ditugaskan ke gudang nanti.</p>
          ) : (
            <ul className="max-h-40 divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300">
              {warehouses.map((w) => (
                <li key={w.id}>
                  <label className="flex cursor-pointer items-center gap-3 p-2.5 text-sm">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={values.warehouseIds.includes(w.id)} onChange={() => toggleWarehouse(w.id)} />
                    {w.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-base-content/60">Pilih satu atau lebih gudang yang dapat diakses oleh anggota.</p>
        </fieldset>
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
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Buat undangan'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
