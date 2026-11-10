import { formatRupiah } from '../../utils/format'
import { Icon, SectionHeading } from './parts'

// Copied from server/seeders/20261105000100-plans.js (there is no public plans endpoint). When the
// seeder changes, change this list too; E9 and E10 replace it with the real subscription screens.
const PLANS = [
  { name: 'Starter', priceIdr: 300000, maxWarehouses: 2, maxProducts: 100, maxMembers: 3 },
  { name: 'Business', priceIdr: 700000, maxWarehouses: 10, maxProducts: 500, maxMembers: 10 },
]

export default function Pricing() {
  return (
    <section id="harga" aria-labelledby="harga-judul" className="mx-auto max-w-300 scroll-mt-16 px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        id="harga-judul"
        center
        title="Harga"
        text="Contoh harga. Semua paket punya fitur yang sama, yang berbeda hanya batas kapasitasnya."
      />
      <div className="mx-auto grid max-w-3xl gap-8 md:grid-cols-2">
        {PLANS.map((plan) => (
          <div key={plan.name} className="flex flex-col justify-between rounded-box border border-base-300 bg-base-100 p-8">
            <div>
              <h3 className="mb-1 text-lg font-bold">{plan.name}</h3>
              <span className="badge badge-ghost badge-sm mb-5">Contoh</span>
              <p className="mb-6 flex items-baseline gap-1">
                <span className="font-mono text-3xl font-extrabold">{formatRupiah(plan.priceIdr)}</span>
                <span className="text-sm text-base-content/60">/ bulan</span>
              </p>
              <ul className="mb-8 space-y-3 text-sm text-base-content/70">
                {[`Hingga ${plan.maxWarehouses} gudang`, `Hingga ${plan.maxProducts} produk`, `Hingga ${plan.maxMembers} anggota`].map((line) => (
                  <li key={line} className="flex items-center gap-2.5">
                    <Icon name="check" className="text-[18px] text-success" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <a href="#demo" className="btn btn-outline w-full border-base-300">
              Coba demo
            </a>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-base-content/60">Harga contoh. Pembayaran hanya sandbox, tidak ada penagihan sungguhan.</p>
    </section>
  )
}
