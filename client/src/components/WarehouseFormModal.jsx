import { useState } from 'react'
import FormField from './FormField'
import PlanLimitNotice from './PlanLimitNotice'
import { GENERIC_ERROR, errorText, fieldErrorsFrom, isPlanLimit } from '../utils/apiError'

// Same limits as the API (docs/04: code 1 to 20, name 1 to 100, address at most 255). The server
// validates again; this only saves a round trip and points at the field.
function validateWarehouse({ code, name, address }) {
  const errors = {}
  if (!code.trim()) errors.code = 'Kode gudang wajib diisi.'
  else if (code.trim().length > 20) errors.code = 'Kode gudang maksimal 20 karakter.'
  if (!name.trim()) errors.name = 'Nama gudang wajib diisi.'
  else if (name.trim().length > 100) errors.name = 'Nama gudang maksimal 100 karakter.'
  if (address.length > 255) errors.address = 'Alamat maksimal 255 karakter.'
  return errors
}

// A 409 CONFLICT ("Kode gudang sudah dipakai.") belongs under the code field; a 400 maps by field path.
function serverErrors(error) {
  const status = error.response?.status
  if (isPlanLimit(error)) return { planLimit: error.response.data.message }
  if (status === 409) return { code: error.response.data.message }
  if (status === 400) {
    const byField = fieldErrorsFrom(error)
    if (Object.keys(byField).length > 0) return byField
  }
  return { general: errorText(error) ?? GENERIC_ERROR }
}

// P01. `warehouse` is null to create, or the row to edit. `onSubmit(values)` does the request and
// rejects with the axios error, so this form can show it next to the field.
export default function WarehouseFormModal({ warehouse, onSubmit, onClose }) {
  const editing = Boolean(warehouse)
  const [values, setValues] = useState({
    code: warehouse?.code ?? '',
    name: warehouse?.name ?? '',
    address: warehouse?.address ?? '',
  })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const set = (field) => (event) => setValues((v) => ({ ...v, [field]: event.target.value }))

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const found = validateWarehouse(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      await onSubmit({ code: values.code.trim(), name: values.name.trim(), address: values.address.trim() })
    } catch (err) {
      setErrors(serverErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="warehouse-form-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="warehouse-form-title" className="text-lg font-semibold">
            {editing ? 'Ubah gudang' : 'Tambah gudang'}
          </h2>
          <p className="text-sm text-base-content/70">
            {editing ? 'Perbarui data gudang.' : 'Daftarkan lokasi fisik baru untuk penyimpanan dan mutasi stok.'}
          </p>
        </div>
        <FormField id="warehouse-code" label="Kode gudang" required maxLength={20} hint="Kode unik di organisasi (contoh: GD-04)." value={values.code} onChange={set('code')} error={errors.code} />
        <FormField id="warehouse-name" label="Nama gudang" required maxLength={100} value={values.name} onChange={set('name')} error={errors.name} />
        <FormField id="warehouse-address" label="Alamat" multiline rows={3} maxLength={255} value={values.address} onChange={set('address')} error={errors.address} />
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
