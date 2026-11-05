import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useAuth } from '../context/authContext'

const BENEFITS = [
  { icon: 'warehouse', title: 'Multi-gudang', text: 'Pantau dan kelola stok di seluruh cabang dan gudang pusat secara terpusat.' },
  { icon: 'history_toggle_off', title: 'Riwayat stok yang tidak bisa diubah', text: 'Setiap perpindahan dan penyesuaian stok tercatat permanen dan transparan.' },
  { icon: 'admin_panel_settings', title: 'Akses sesuai peran', text: 'Batasi wewenang operasional khusus untuk Owner, Admin Gudang, dan Viewer.' },
]

// The API answers "/platform" for a platform admin; the screen for it (S19) lives at this path.
function targetPath(redirectTo) {
  return redirectTo === '/platform' ? '/platform/organizations' : redirectTo
}

// Shows the API message for a rejected login (the API texts are already Indonesian), and a fixed
// text when there is no response at all (server down, no network).
function errorText(error) {
  if (!error.response) return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.'
  if (error.response.status >= 500) return 'Terjadi kesalahan. Silakan coba lagi.'
  return error.response.data?.message ?? 'Terjadi kesalahan. Silakan coba lagi.'
}

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>
}

function BrandPanel() {
  return (
    <section className="flex flex-col gap-10 border-b border-base-300 bg-base-300/40 p-8 lg:w-[45%] lg:border-b-0 lg:border-r lg:p-14">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
        <span className="text-xl font-bold">Simpul</span>
        <span className="badge badge-primary badge-soft badge-sm">Stok</span>
      </div>
      <div className="max-w-lg space-y-3">
        <h1 className="text-3xl font-extrabold tracking-tight lg:text-4xl">Semua cabang, satu simpul.</h1>
        <p className="text-base-content/70">Platform manajemen inventori multi-cabang terpadu untuk operasional UKM yang rapi dan terukur.</p>
      </div>
      <ul className="hidden max-w-lg space-y-3 lg:block">
        {BENEFITS.map((item) => (
          <li key={item.title} className="flex items-start gap-3 rounded-xl border border-base-300 bg-base-100/80 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name={item.icon} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{item.title}</h2>
              <p className="text-sm text-base-content/70">{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// S01. Public route. Shows the API error under the password field; the same text is used for a
// wrong email and a wrong password on purpose (the API does not reveal which one was wrong).
export default function Login() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Someone who is already logged in has no business here.
  if (!loading && user) return <Navigate to={user.role === 'PLATFORM_ADMIN' ? '/platform/organizations' : '/dashboard'} replace />

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const redirectTo = await login(email.trim(), password)
      navigate(targetPath(redirectTo), { replace: true })
    } catch (err) {
      setError(errorText(err))
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-360 flex-col bg-base-200 lg:flex-row">
      <BrandPanel />
      <section className="flex flex-1 flex-col items-center justify-center p-6 lg:p-14">
        <div className="w-full max-w-115 rounded-xl border border-base-300 bg-base-100 p-8 lg:p-10">
          <h2 className="text-2xl font-bold tracking-tight">Masuk ke Simpul</h2>
          <p className="mt-1 text-sm text-base-content/70">Kelola operasional dan stok cabang bisnis Anda.</p>

          <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-semibold">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                placeholder="nama@perusahaan.com"
                className="input w-full"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-semibold">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  placeholder="Masukkan password"
                  className={`input w-full pr-10 ${error ? 'input-error' : ''}`}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="Tampilkan atau sembunyikan password"
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-base-content/50 hover:text-base-content"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <Icon name={showPassword ? 'visibility_off' : 'visibility'} className="text-[20px]" />
                </button>
              </div>
              {error && (
                <p id="login-error" role="alert" className="flex items-center gap-1.5 pt-1 text-sm font-medium text-error">
                  <Icon name="error" className="text-[18px]" />
                  {error}
                </p>
              )}
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={submitting || !email || !password}>
              {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Masuk'}
            </button>
            <p className="text-center text-xs text-base-content/70">Lupa password? Hubungi Owner organisasi Anda.</p>
          </form>

          <div className="mt-6 border-t border-base-300 pt-6 text-center text-sm text-base-content/70">
            Belum punya akun?{' '}
            <Link to="/register" className="link link-primary no-underline">
              Daftarkan organisasi
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
