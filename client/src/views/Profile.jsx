import { useState } from 'react'
import { useNavigate } from 'react-router'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { ROLE_LABELS } from '../constants/navigation'
import { useAuth } from '../context/authContext'

function ReadOnlyField({ label, value }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-sm">{value}</div>
    </div>
  )
}

// S17. Name, email and role cannot be edited here (read only, as in the design).
export default function Profile() {
  const { user, organization, logout } = useAuth()
  const navigate = useNavigate()
  const [changing, setChanging] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profil saya</h1>
        <p className="text-sm text-base-content/70">Kelola informasi profil pribadi dan pengaturan keamanan akun Simpul Anda.</p>
      </div>

      <section className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-6">
        <div className="flex items-center justify-between border-b border-base-300 pb-3">
          <h2 className="font-bold">Informasi profil</h2>
          <span className="badge badge-success badge-soft">Aktif</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Nama" value={user.name} />
          <ReadOnlyField label="Email" value={user.email} />
          <ReadOnlyField label="Peran akun" value={ROLE_LABELS[user.role] ?? user.role} />
          <ReadOnlyField label="Organisasi" value={organization?.name ?? '-'} />
        </div>
      </section>

      <section className="rounded-xl border border-base-300 bg-base-100 p-6">
        <h2 className="border-b border-base-300 pb-3 font-bold">Keamanan</h2>
        <div className="flex items-center justify-between pt-4">
          <span className="font-semibold">Password</span>
          <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
            Ubah password
          </button>
        </div>
      </section>

      <section className="flex items-center justify-between rounded-xl border border-base-300 bg-base-100 p-6">
        <div>
          <h2 className="font-semibold">Keluar dari sesi</h2>
          <p className="text-sm text-base-content/70">Keluar dari sesi saat ini di perangkat ini.</p>
        </div>
        <button type="button" className="btn btn-outline btn-error btn-sm" onClick={handleLogout}>
          Keluar
        </button>
      </section>

      {changing && <ChangePasswordModal onClose={() => setChanging(false)} />}
    </div>
  )
}
