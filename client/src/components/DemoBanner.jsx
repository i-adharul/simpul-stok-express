// BL31. Shown at the top of the app layout during a demo account session (user.isDemo from GET /api/me).
export default function DemoBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-info/30 bg-info/10 px-4 py-2 text-center text-sm text-info">
      <span className="material-symbols-outlined text-[18px]">science</span>
      <span>
        <strong>Mode demo</strong>: data bersifat publik dan direset berkala. Jangan masukkan data pribadi.
      </span>
    </div>
  )
}
