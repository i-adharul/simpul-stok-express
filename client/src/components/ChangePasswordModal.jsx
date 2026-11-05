import { useState } from 'react'
import http, { setToken } from '../utils/http'
import { toast } from '../utils/toast'

function PasswordField({ id, label, value, onChange, error, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={128}
          className={`input w-full pr-10 ${error ? 'input-error' : ''}`}
          aria-invalid={Boolean(error)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label="Tampilkan atau sembunyikan password"
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-base-content/50"
          onClick={() => setShow((v) => !v)}
        >
          <span className="material-symbols-outlined text-[20px]">{show ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  )
}

// Maps an API error to the field it belongs to (docs/04: INVALID_CURRENT_PASSWORD, or VALIDATION_ERROR
// with details[].path === 'newPassword'). Anything else becomes a general message.
function fieldErrors(error) {
  const data = error.response?.data
  if (data?.code === 'INVALID_CURRENT_PASSWORD') return { current: data.message }
  const detail = data?.details?.find?.((d) => d.path === 'newPassword')
  if (detail) return { next: detail.message }
  if (data?.code === 'VALIDATION_ERROR') return { general: data.message }
  return { general: 'Terjadi kesalahan. Silakan coba lagi.' }
}

// P17. On success the API returns a new token for this device; the old one (and every other device) is dead.
export default function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    if (newPassword !== confirm) {
      setErrors({ confirm: 'Konfirmasi password tidak sama.' })
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      const { data } = await http.patch('/api/me/password', { currentPassword, newPassword })
      setToken(data.token)
      toast.success('Password berhasil diubah.')
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      setSubmitting(false)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="change-password-title">
      <form className="modal-box max-w-md space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <h2 id="change-password-title" className="text-lg font-semibold">
            Ubah password
          </h2>
          <p className="text-sm text-base-content/70">Perbarui password akun Anda untuk menjaga keamanan akses.</p>
        </div>
        <PasswordField id="current-password" label="Password saat ini" autoComplete="current-password" value={currentPassword} onChange={setCurrent} error={errors.current} />
        <PasswordField id="new-password" label="Password baru" autoComplete="new-password" value={newPassword} onChange={setNew} error={errors.next} />
        <p className="text-xs text-base-content/60">Minimal 8 karakter, mengandung huruf dan angka.</p>
        <PasswordField id="confirm-password" label="Konfirmasi password baru" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
        {errors.general && (
          <p role="alert" className="text-sm font-medium text-error">
            {errors.general}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || !currentPassword || !newPassword || !confirm}>
            {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Simpan password'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
