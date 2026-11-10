import { GITHUB_URL, README_URL } from '../../constants/landing'

// The Legal link is added with E13-06.
export default function Footer() {
  return (
    <footer className="mt-10 border-t border-base-300 bg-base-100 py-10">
      <div className="mx-auto flex max-w-300 flex-col items-center justify-between gap-4 px-4 sm:px-6 md:flex-row">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-xs font-bold text-primary-content">S</span>
          <span className="font-bold">Simpul Stok</span>
        </div>
        <nav aria-label="Tautan" className="flex items-center gap-6 text-sm text-base-content/70">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-primary">
            GitHub
          </a>
          <a href={README_URL} target="_blank" rel="noreferrer" className="hover:text-primary">
            README
          </a>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-300 px-4 text-center text-xs text-base-content/60 sm:px-6">
        Dibuat oleh Adharul Imron. Proyek portofolio teknis untuk sistem stok multi-gudang. Data demo bersifat publik dan direset berkala.
      </p>
    </footer>
  )
}
