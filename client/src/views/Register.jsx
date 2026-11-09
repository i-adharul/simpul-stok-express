import { useState } from 'react'
import { Link } from 'react-router'
import FormField from '../components/FormField'
import { PASSWORD_HINT, suggestSlug, validateOrganization, validateOwner } from '../utils/registerForm'

const STEPS = [
  { number: 1, title: 'Data perusahaan' },
  { number: 2, title: 'Akun Owner' },
]

function StepIndicator({ current }) {
  return (
    <ol className="mb-7 flex items-center justify-between border-b border-base-300 pb-6">
      {STEPS.map((step) => {
        const active = step.number === current
        return (
          <li key={step.number} className="flex items-center gap-2.5" aria-current={active ? 'step' : undefined}>
            <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-primary text-primary-content' : 'border border-base-300 bg-base-200 text-base-content/60'}`}>
              {step.number}
            </span>
            <span className="flex flex-col text-xs">
              <span className={active ? 'font-semibold text-primary' : 'text-base-content/60'}>Langkah {step.number}</span>
              <span className="font-medium">{step.title}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// S02, step 1 of 2: organization data. The slug follows the name until the user edits it by hand.
function OrganizationStep({ values, errors, onChange, onNext }) {
  return (
    <form className="space-y-5" noValidate onSubmit={onNext}>
      <FormField
        id="organizationName"
        label="Nama organisasi"
        required
        maxLength={100}
        placeholder="Contoh: Kopi Senja, Toko Makmur"
        hint="Nama resmi bisnis atau jaringan gerai cabang Anda."
        error={errors.organizationName}
        value={values.organizationName}
        onChange={(event) => onChange('organizationName', event.target.value)}
      />
      <FormField
        id="slug"
        label="Slug organisasi"
        required
        maxLength={30}
        autoComplete="off"
        hint="Dipakai sebagai pengenal unik organisasi. Hanya huruf kecil dan angka."
        error={errors.slug}
        value={values.slug}
        onChange={(event) => onChange('slug', event.target.value)}
      />
      <button type="submit" className="btn btn-primary w-full">
        Lanjut
      </button>
      <p className="text-center text-xs text-base-content/70">
        Sudah punya akun?{' '}
        <Link to="/login" className="link link-primary no-underline">
          Masuk
        </Link>
      </p>
    </form>
  )
}

// S02, step 2 of 2: the Owner account. "Kembali" only changes the step; the values stay in the parent.
function OwnerStep({ values, errors, onChange, onBack, onSubmit }) {
  const [showPassword, setShowPassword] = useState(false)
  return (
    <form className="space-y-5" noValidate onSubmit={onSubmit}>
      <FormField
        id="name"
        label="Nama lengkap"
        required
        maxLength={100}
        placeholder="Nama lengkap Anda"
        autoComplete="name"
        error={errors.name}
        value={values.name}
        onChange={(event) => onChange('name', event.target.value)}
      />
      <FormField
        id="email"
        label="Email kerja"
        required
        type="email"
        maxLength={254}
        placeholder="nama@domain.com"
        autoComplete="username"
        hint="Digunakan untuk masuk dan menerima laporan inventori."
        error={errors.email}
        value={values.email}
        onChange={(event) => onChange('email', event.target.value)}
      />
      <FormField
        id="password"
        label="Password"
        required
        type={showPassword ? 'text' : 'password'}
        maxLength={128}
        autoComplete="new-password"
        hint={PASSWORD_HINT}
        error={errors.password}
        value={values.password}
        onChange={(event) => onChange('password', event.target.value)}
      />
      <FormField
        id="passwordConfirm"
        label="Konfirmasi password"
        required
        type={showPassword ? 'text' : 'password'}
        maxLength={128}
        autoComplete="new-password"
        error={errors.passwordConfirm}
        value={values.passwordConfirm}
        onChange={(event) => onChange('passwordConfirm', event.target.value)}
      />
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="checkbox checkbox-sm" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
        Tampilkan password
      </label>
      <p className="rounded-lg border border-base-300 bg-base-200 p-3 text-xs text-base-content/70">
        Akun ini otomatis menjadi pengelola utama (Owner) untuk <strong>{values.organizationName.trim()}</strong>.
      </p>
      <div className="flex items-center gap-3">
        <button type="button" className="btn" onClick={onBack}>
          Kembali
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          Daftarkan akun
        </button>
      </div>
      <p className="text-center text-xs text-base-content/70">
        Sudah punya akun?{' '}
        <Link to="/login" className="link link-primary no-underline">
          Masuk
        </Link>
      </p>
    </form>
  )
}

// S02. Public route. All input lives here, so going back from step 2 keeps what was typed.
export default function Register() {
  const [step, setStep] = useState(1)
  const [slugEdited, setSlugEdited] = useState(false)
  const [values, setValues] = useState({ organizationName: '', slug: '', name: '', email: '', password: '', passwordConfirm: '' })
  const [errors, setErrors] = useState({})

  function handleChange(name, value) {
    setValues((current) => {
      const next = { ...current, [name]: value }
      if (name === 'organizationName' && !slugEdited) next.slug = suggestSlug(value)
      return next
    })
    if (name === 'slug') setSlugEdited(true)
    setErrors((current) => ({ ...current, [name]: undefined }))
  }

  function handleNext(event) {
    event.preventDefault()
    const found = validateOrganization(values)
    setErrors(found)
    if (Object.keys(found).length === 0) setStep(2)
  }

  function handleSubmit(event) {
    event.preventDefault()
    const found = validateOwner(values)
    setErrors(found)
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-base-200 px-6 py-10">
      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
        <span className="text-2xl font-bold">Simpul</span>
        <span className="badge badge-primary badge-soft badge-sm">Stok</span>
      </div>
      <div className="w-full max-w-120 rounded-xl border border-base-300 bg-base-100 p-8">
        <h1 className="text-2xl font-bold tracking-tight">Daftarkan organisasi</h1>
        <p className="mb-6 mt-1 text-sm text-base-content/70">Mulai kelola stok multi-cabang dengan platform terpusat.</p>
        <StepIndicator current={step} />
        {step === 1 && <OrganizationStep values={values} errors={errors} onChange={handleChange} onNext={handleNext} />}
        {step === 2 && <OwnerStep values={values} errors={errors} onChange={handleChange} onBack={() => setStep(1)} onSubmit={handleSubmit} />}
      </div>
    </main>
  )
}
