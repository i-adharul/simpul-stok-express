import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import ErrorState from '../components/ErrorState'
import FormField from '../components/FormField'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { ROLE_LABELS } from '../constants/navigation'
import { useAuth } from '../context/authContext'
import { GENERIC_ERROR, errorText, fieldErrorsFrom } from '../utils/apiError'
import http from '../utils/http'
import { PASSWORD_HINT, validateAccept } from '../utils/registerForm'

function BrandHeader() {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
      <span className="text-2xl font-bold">Simpul</span>
      <span className="badge badge-primary badge-soft badge-sm">Stok</span>
    </div>
  )
}

// S03 expired variant: one message for an expired, used, unknown or malformed link (the API answers 404 for all).
function ExpiredCard() {
  return (
    <div className="space-y-4 text-center">
      <span className="material-symbols-outlined text-[40px] text-base-content/50">history</span>
      <h1 className="text-2xl font-bold tracking-tight">Tautan undangan tidak berlaku</h1>
      <p className="text-sm text-base-content/70">Tautan ini sudah kedaluwarsa, sudah dipakai, atau tidak valid. Minta Owner organisasi Anda mengirim tautan undangan baru.</p>
      <Link to="/login" className="btn btn-primary w-full">
        Ke halaman masuk
      </Link>
    </div>
  )
}

// S03, the form: the email is read-only (it comes from the invitation), the rest is typed here.
function AcceptForm({ invitation, values, errors, formError, submitting, onChange, onSubmit }) {
  return (
    <form className="mt-6 space-y-5" noValidate onSubmit={onSubmit}>
      <FormField id="email" label="Email terdaftar" readOnly value={invitation.email} hint="Dari undangan." />
      <FormField id="name" label="Nama lengkap" required maxLength={100} autoComplete="name" value={values.name} onChange={(e) => onChange('name', e.target.value)} error={errors.name} />
      <FormField id="password" label="Password baru" required type="password" maxLength={128} autoComplete="new-password" hint={PASSWORD_HINT} value={values.password} onChange={(e) => onChange('password', e.target.value)} error={errors.password} />
      <FormField id="passwordConfirm" label="Konfirmasi password" required type="password" maxLength={128} autoComplete="new-password" value={values.passwordConfirm} onChange={(e) => onChange('passwordConfirm', e.target.value)} error={errors.passwordConfirm} />
      {formError && (
        <p role="alert" className="text-sm font-medium text-error">
          {formError}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
        {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Terima undangan'}
      </button>
    </form>
  )
}

// S03. Public route; the token in the URL is the proof. GET /api/invitations/:token tells who is invited.
export default function AcceptInvite() {
  const { token } = useParams()
  const { acceptInvite } = useAuth()
  const navigate = useNavigate()
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [invitation, setInvitation] = useState(null)
  // 'expired' (404 from the API) or 'failed' (no answer or 5xx: the link may still be fine, so offer a retry)
  const [problem, setProblem] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [values, setValues] = useState({ name: '', password: '', passwordConfirm: '' })
  const [errors, setErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    http
      .get(`/api/invitations/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (cancelled) return
        setInvitation(data)
        setProblem(null)
      })
      .catch((error) => {
        if (!cancelled) setProblem(error.response?.status === 404 ? 'expired' : 'failed')
      })
    return () => {
      cancelled = true
    }
  }, [token, attempt])

  function retry() {
    setProblem(null)
    setAttempt((n) => n + 1)
  }

  function handleChange(name, value) {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  // 400 names the field (the password reason); 409 and 403 (plan limit) carry a message for the whole form.
  function showServerError(error) {
    const fields = fieldErrorsFrom(error)
    setErrors(fields)
    if (Object.keys(fields).length === 0) setFormError(errorText(error) ?? GENERIC_ERROR)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    const found = validateAccept(values)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return
    setSubmitting(true)
    try {
      const redirectTo = await acceptInvite({ token, name: values.name.trim(), password: values.password })
      navigate(redirectTo, { replace: true })
    } catch (error) {
      // The link died between the GET and the POST (used or expired meanwhile): show the expired variant.
      if (error.response?.status === 404) setProblem('expired')
      else showServerError(error)
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-base-200 px-6 py-10">
      <BrandHeader />
      <div className="w-full max-w-115 rounded-xl border border-base-300 bg-base-100 p-8">
        {problem === 'expired' && <ExpiredCard />}
        {problem === 'failed' && <ErrorState message="Undangan tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi." onRetry={retry} />}
        {!invitation && !problem && <LoadingSkeleton rows={4} />}
        {invitation && problem !== 'expired' && (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Anda diundang bergabung ke {invitation.organizationName}</h1>
            <p className="mt-1 text-sm text-base-content/70">
              Peran: <strong>{ROLE_LABELS[invitation.role] ?? invitation.role}</strong>. Lengkapi data akun di bawah ini.
            </p>
            <AcceptForm invitation={invitation} values={values} errors={errors} formError={formError} submitting={submitting} onChange={handleChange} onSubmit={handleSubmit} />
          </>
        )}
      </div>
    </main>
  )
}
