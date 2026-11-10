import { Icon, SectionHeading } from './parts'

const FEATURES = [
  { icon: 'warehouse', title: 'Multi-gudang', text: 'Lihat stok seluruh gudang dan cabang dalam satu aplikasi, per produk maupun per gudang.' },
  { icon: 'swap_horiz', title: 'Mutasi antar gudang', text: 'Selesai seluruhnya atau dibatalkan seluruhnya. Stok tidak pernah hilang di tengah jalan.' },
  { icon: 'history', title: 'Riwayat yang tidak bisa diubah', text: 'Setiap penerimaan, penyesuaian, dan mutasi tercatat permanen dan tidak bisa diedit atau dihapus.' },
  { icon: 'admin_panel_settings', title: 'Akses sesuai peran', text: 'Owner, Admin Gudang, dan Viewer punya wewenang berbeda, dan server yang memeriksanya di setiap permintaan.' },
  { icon: 'dashboard', title: 'Dashboard stok', text: 'Produk yang habis atau menipis langsung disorot, tanpa perlu menghitung di spreadsheet.' },
  { icon: 'group_add', title: 'Anggota dan undangan', text: 'Owner mengundang anggota lewat tautan dan menugaskan mereka ke gudang tertentu.' },
]

export default function Features() {
  return (
    <section id="fitur" aria-labelledby="fitur-judul" className="border-t border-base-300 bg-base-100/60 py-16 sm:py-20">
      <div className="mx-auto max-w-300 px-4 sm:px-6">
        <SectionHeading id="fitur-judul" center title="Dirancang untuk disiplin operasional" text="Yang dibutuhkan untuk menjaga saldo barang tetap benar di banyak gudang." />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((item) => (
            <div key={item.title} className="rounded-box border border-base-300 bg-base-100 p-6">
              <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon name={item.icon} />
              </span>
              <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
              <p className="text-sm leading-relaxed text-base-content/70">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
