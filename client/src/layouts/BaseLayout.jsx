import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../context/authContext'
import { ROLE_LABELS, visibleNav } from '../constants/navigation'

function Icon({ name, className = '' }) {
  return <span className={`material-symbols-outlined text-[20px] ${className}`}>{name}</span>
}

function Sidebar({ user, onNavigate }) {
  const groups = visibleNav(user.role)
  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-base-100 p-4">
      <div>
        <div className="flex items-center gap-2 border-b border-base-300 pb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</div>
          <span className="font-bold">Simpul</span>
          <span className="badge badge-primary badge-soft badge-sm">Stok</span>
        </div>
        <div className="my-4 truncate rounded-lg border border-base-300 bg-base-200 p-2 text-sm font-semibold">
          {user.organizationName}
        </div>
        <nav className="space-y-4">
          {groups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2 text-[11px] font-bold uppercase tracking-wider text-base-content/60">{group.title}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/70 hover:bg-base-200'
                    }`
                  }
                >
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="mt-4 border-t border-base-300 pt-3">
        <p className="truncate text-sm font-semibold">{user.name}</p>
        <span className="badge badge-ghost badge-sm">{ROLE_LABELS[user.role] ?? user.role}</span>
      </div>
    </div>
  )
}

// Layout route: the sidebar and top bar stay, <Outlet /> is replaced by the current view.
// The user comes from AuthContext; ProtectedRoute guarantees there is one.
export default function BaseLayout() {
  const { user: authUser, organization, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const user = { ...authUser, organizationName: organization?.name ?? '' }

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-base-200">
      <aside className="hidden w-62 shrink-0 border-r border-base-300 lg:block">
        <Sidebar user={user} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Tutup menu" className="absolute inset-0 bg-black/40" onClick={close} />
          <aside className="absolute inset-y-0 left-0 w-62 shadow-xl">
            <Sidebar user={user} onNavigate={close} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-base-300 bg-base-100 px-4">
          <button aria-label="Buka menu" className="btn btn-ghost btn-sm btn-square lg:hidden" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <span className="hidden text-sm text-base-content/60 lg:inline">{user.organizationName}</span>
          <div className="flex items-center gap-2 text-sm">
            <Link to="/profile" className="font-semibold hover:underline">{user.name}</Link>
            <button className="btn btn-ghost btn-sm btn-square" title="Keluar dari akun" aria-label="Keluar" onClick={handleLogout}>
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto w-full max-w-300">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
