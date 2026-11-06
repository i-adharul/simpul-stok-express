import { Link, useNavigate } from 'react-router'

// Shared body of the S23 pages (404, 403, 500). Each page passes its own wording and actions,
// so the three pages look the same and only the text differs.
export default function ErrorPage({ status, title, message, icon, children }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center rounded-xl border border-base-300 bg-base-100 px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[28px]">{icon}</span>
      </div>
      <span className="badge badge-primary badge-soft mb-3">Status {status}</span>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <p className="mb-6 max-w-md text-sm text-base-content/70">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">{children}</div>
    </section>
  )
}

export function DashboardButton() {
  return (
    <Link to="/dashboard" className="btn btn-primary">
      <span className="material-symbols-outlined text-[18px]">dashboard</span>
      Ke dashboard
    </Link>
  )
}

export function BackButton() {
  const navigate = useNavigate()
  return (
    <button type="button" className="btn" onClick={() => navigate(-1)}>
      <span className="material-symbols-outlined text-[18px]">arrow_back</span>
      Kembali
    </button>
  )
}
