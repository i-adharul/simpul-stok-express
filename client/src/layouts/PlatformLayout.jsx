import { Navigate, NavLink, Outlet, useNavigate } from 'react-router'
import ErrorBoundary from '../components/ErrorBoundary'
import LoadingSkeleton from '../components/LoadingSkeleton'
import Forbidden from '../views/Forbidden'
import { useAuth } from '../context/authContext'

// Layout and guard of `/platform/*` (S19 and S20). Only the Platform admin belongs here: no session goes to
// the login screen, any tenant role gets the S23 403 page. The server answers 403 on every /api/platform
// endpoint for the other roles; this only keeps them from seeing an empty console.
// A Platform admin has no organization, so the sidebar has one item and no tenant menu.
export default function PlatformLayout() {
  const { user, loading, sessionExpired, logout } = useAuth()
  const navigate = useNavigate()

  if (loading) return <LoadingSkeleton rows={3} />
  if (!user) return sessionExpired ? null : <Navigate to="/login" replace />
  if (user.role !== 'PLATFORM_ADMIN') return <Forbidden />

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-base-200">
      <aside className="hidden w-62 shrink-0 flex-col justify-between border-r border-base-300 bg-base-100 p-4 lg:flex">
        <div>
          <div className="flex items-center gap-2 border-b border-base-300 pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
            <span className="font-bold">Simpul</span>
            <span className="badge badge-neutral badge-soft badge-sm">Platform</span>
          </div>
          <nav className="mt-4">
            <NavLink
              to="/platform/organizations"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/70 hover:bg-base-200'}`
              }
            >
              <span className="material-symbols-outlined text-[20px]">domain</span>
              Organisasi
            </NavLink>
          </nav>
        </div>
        <div className="border-t border-base-300 pt-3">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <span className="badge badge-ghost badge-sm">Platform admin</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-base-300 bg-base-100 px-4">
          <span className="text-sm font-semibold lg:hidden">Simpul Platform</span>
          <span className="hidden text-sm text-base-content/60 lg:inline">Konsol platform</span>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{user.name}</span>
            <button className="btn btn-ghost btn-sm btn-square" title="Keluar dari akun" aria-label="Keluar" onClick={handleLogout}>
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto w-full max-w-300">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
