import { GITHUB_URL } from '../../constants/landing'
import { Icon, Shot } from './parts'

export default function Hero() {
  return (
    <section className="mx-auto max-w-300 px-4 py-12 sm:px-6 lg:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="flex flex-col items-start lg:col-span-5">
          <span className="badge badge-ghost mb-5 h-auto gap-2 py-1 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Proyek portofolio · pembayaran sandbox
          </span>
          <h1 className="mb-5 text-4xl font-extrabold leading-[1.15] tracking-tight lg:text-5xl">Semua cabang, satu simpul.</h1>
          <p className="mb-8 max-w-lg text-base leading-relaxed text-base-content/70">
            Simpul Stok mencatat, memindahkan, dan menelusuri stok antar gudang. Tanpa stok minus, tanpa data setengah jalan, tanpa
            tercampur dengan perusahaan lain.
          </p>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <a href="#demo" className="btn btn-primary">
              Coba demo langsung
              <Icon name="arrow_forward" className="text-[18px]" />
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn-outline border-base-300 bg-base-100">
              <Icon name="code" className="text-[18px]" />
              Lihat kode di GitHub
            </a>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-base-content/60">
            <Icon name="check_circle" className="text-[14px]" />
            Tanpa daftar. Pilih peran, langsung masuk.
          </p>
        </div>
        <div className="lg:col-span-7">
          <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-lg">
            <Shot name="dashboard" eager alt="Dashboard Simpul Stok dengan data demo: ringkasan produk, stok menipis, dan aktivitas terbaru" />
          </div>
          <p className="mt-2 text-center text-xs text-base-content/60">Tangkapan layar aplikasi dengan data demo.</p>
        </div>
      </div>
    </section>
  )
}
