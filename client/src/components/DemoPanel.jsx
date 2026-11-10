import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../context/authContext'

const DEMO_ROLES = [
  { role: 'OWNER', label: 'Owner', text: 'Kelola gudang, produk, anggota, dan pengaturan organisasi.' },
  { role: 'WAREHOUSE_ADMIN', label: 'Admin Gudang', text: 'Catat penerimaan, penyesuaian, dan mutasi stok di gudang yang ditugaskan.' },
  { role: 'VIEWER', label: 'Viewer', text: 'Lihat stok dan riwayat saja, tanpa bisa mengubah data.' },
]

const UNAVAILABLE = 'Demo sedang tidak tersedia. Coba lagi sebentar.'

// S01, BL31. The "Coba demo" panel: an explanation box and one button per demo role. A click signs in
// through POST /api/auth/demo-login, stores the token like a normal login, then goes to S04. Every
// failure (404 demo off, 5xx, no network) shows the same message.
export default function DemoPanel() {
  const { demoLogin } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(null) // the role being signed in, or null
  const [error, setError] = useState(null)

  async function handleClick(role) {
    if (pending) return
    setPending(role)
    setError(null)
    try {
      const redirectTo = await demoLogin(role)
      navigate(redirectTo === '/platform' ? '/platform/organizations' : redirectTo, { replace: true })
    } catch {
      setError(UNAVAILABLE)
      setPending(null)
    }
  }

  return (
    <section aria-labelledby="demo-title" className="space-y-3">
      <div className="rounded-box border border-info/30 bg-info/10 p-3 text-sm">
        <h3 id="demo-title" className="font-semibold">
          Coba demo
        </h3>
        <p className="text-base-content/70">Tidak perlu daftar atau password. Buka jendela incognito untuk mencoba dua peran sekaligus.</p>
      </div>
      <ul className="space-y-2">
        {DEMO_ROLES.map((item) => (
          <li key={item.role}>
            <button
              type="button"
              className="btn btn-outline h-auto w-full flex-col items-start gap-0.5 py-2.5 text-left"
              disabled={Boolean(pending)}
              onClick={() => handleClick(item.role)}
            >
              <span className="font-semibold">{pending === item.role ? 'Masuk...' : `Masuk sebagai ${item.label}`}</span>
              <span className="text-xs font-normal text-base-content/70">{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </section>
  )
}
