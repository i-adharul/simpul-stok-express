import { Link, Outlet } from 'react-router'
import { GITHUB_URL, NAV_LINKS } from '../constants/landing'

function GithubIcon() {
  return (
    <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

// Layout of the public landing page (S24): no sidebar, a sticky navbar, and the page in <Outlet />.
export default function LandingLayout() {
  return (
    <div className="min-h-screen scroll-smooth bg-base-200">
      <header className="sticky top-0 z-50 border-b border-base-300 bg-base-100/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-300 items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2" aria-label="Simpul Stok, halaman awal">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-content">S</span>
            <span className="font-bold">Simpul</span>
            <span className="badge badge-primary badge-soft badge-sm">Stok</span>
          </Link>
          <nav aria-label="Bagian halaman" className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="text-sm text-base-content/70 transition-colors hover:text-primary">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="Kode di GitHub" className="btn btn-ghost btn-sm btn-square hidden sm:inline-flex">
              <GithubIcon />
            </a>
            <Link to="/login" className="btn btn-ghost btn-sm">
              Masuk
            </Link>
            <a href="#demo" className="btn btn-primary btn-sm">
              Coba demo
            </a>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
