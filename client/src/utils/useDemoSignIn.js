import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../context/authContext'

export const DEMO_ROLES = [
  { role: 'OWNER', label: 'Owner', icon: 'person', text: 'Kelola gudang, produk, anggota, dan pengaturan organisasi.' },
  { role: 'WAREHOUSE_ADMIN', label: 'Admin Gudang', icon: 'storefront', text: 'Catat penerimaan, penyesuaian, dan mutasi stok di gudang yang ditugaskan.' },
  { role: 'VIEWER', label: 'Viewer', icon: 'visibility', text: 'Lihat stok dan riwayat saja, tanpa bisa mengubah data.' },
]

export const DEMO_UNAVAILABLE = 'Demo sedang tidak tersedia. Coba lagi sebentar.'

// S01 and S24 (BL31). One click signs in through POST /api/auth/demo-login, stores the token like a normal
// login, then goes to S04. Every failure (404 demo off, 5xx, no network) gives the same message.
// `pending` is the role being signed in (or null), `error` the message to show (or null).
export function useDemoSignIn() {
  const { demoLogin } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)

  async function signIn(role) {
    if (pending) return
    setPending(role)
    setError(null)
    try {
      const redirectTo = await demoLogin(role)
      navigate(redirectTo === '/platform' ? '/platform/organizations' : redirectTo, { replace: true })
    } catch {
      setError(DEMO_UNAVAILABLE)
      setPending(null)
    }
  }

  return { pending, error, signIn }
}
