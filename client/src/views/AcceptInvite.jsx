import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import FormField from '../components/FormField'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { ROLE_LABELS } from '../constants/navigation'
import { PASSWORD_HINT, validateAccept } from '../utils/registerForm'
import http from '../utils/http'

function BrandHeader() {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
      <span className="text-2xl font-bold">Simpul</span>
      <span className="badge badge-primary badge-soft badge-sm">Stok</span>
    </div>
  )
}

// S03, the form: the email is read-only (it comes from the invitation), the rest is typed here.
function AcceptForm({ invitation, values, errors, onChange, onSubmit }) {
  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={onSubmit}>
      <FormField id="email" label="Email terdaftar" readOnly value={invitation.email} hint="Dari undangan." />
      <FormField id="name" label="Nama lengkap" required maxLength={100} autoComplete="name" value={values.name} onChange={(e) => onChange('name', e.target.value)} error={errors.name} />
      <FormField id="password" label="Password baru" required type="password" maxLength={128} autoComplete="new-password" hint={PASSWORD_HINT} value={values.password} onChange={(e) => onChange('password', e.target.value)} error={errors.password} />
      <FormField id="passwordConfirm" label="Konfirmasi password" required type="password" maxLength={128} autoComplete="new-password" value={values.passwordConfirm} onChange={(e) => onChange('passwordConfirm', e.target.value)} error={errors.passwordConfirm} />
      <button type="submit" className="btn btn-primary w-full">
        Terima undangan
      </button>
    </form>
  )
}

// S03. Public route; the token in the URL is the proof. GET /api/invitations/:token tells who is invited.
export default function AcceptInvite() {
  const { token } = useParams()
  const [invitation, setInvitation] = useState(null)
  const [values, setValues] = useState({ name: '', password: '', passwordConfirm: '' })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    http
      .get(`/api/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (!cancelled) setInvitation(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token])

  function handleChange(name, value) {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    setErrors(validateAccept(values))
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-base-200 px-6 py-10">
      <BrandHeader />
      <div className="w-full max-w-115 rounded-xl border border-base-300 bg-base-100 p-8">
        {!invitation && <LoadingSkeleton rows={4} />}
        {invitation && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Anda diundang bergabung ke {invitation.organizationName}</h1>
            <p className="mt-1 text-sm text-base-content/70">
              Peran: <strong>{ROLE_LABELS[invitation.role] ?? invitation.role}</strong>. Lengkapi data akun di bawah ini.
            </p>
            <AcceptForm invitation={invitation} values={values} errors={errors} onChange={handleChange} onSubmit={handleSubmit} />
          </>
        )}
      </div>
    </main>
  )
}
