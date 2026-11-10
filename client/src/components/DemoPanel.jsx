// S01, BL31. The "Coba demo" panel: an explanation box and one button per demo role.
export const DEMO_ROLES = [
  { role: 'OWNER', label: 'Owner', text: 'Kelola gudang, produk, anggota, dan pengaturan organisasi.' },
  { role: 'WAREHOUSE_ADMIN', label: 'Admin Gudang', text: 'Catat penerimaan, penyesuaian, dan mutasi stok di gudang yang ditugaskan.' },
  { role: 'VIEWER', label: 'Viewer', text: 'Lihat stok dan riwayat saja, tanpa bisa mengubah data.' },
]

export default function DemoPanel() {
  return (
    <section aria-labelledby="demo-title" className="space-y-3">
      <div className="rounded-box border border-info/30 bg-info/10 p-3 text-sm">
        <h3 id="demo-title" className="font-semibold">
          Coba demo
        </h3>
        <p className="text-base-content/70">
          Tidak perlu daftar atau password. Buka jendela incognito untuk mencoba dua peran sekaligus.
        </p>
      </div>
      <ul className="space-y-2">
        {DEMO_ROLES.map((item) => (
          <li key={item.role}>
            <button type="button" className="btn btn-outline h-auto w-full flex-col items-start gap-0.5 py-2.5 text-left">
              <span className="font-semibold">Masuk sebagai {item.label}</span>
              <span className="text-xs font-normal text-base-content/70">{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
