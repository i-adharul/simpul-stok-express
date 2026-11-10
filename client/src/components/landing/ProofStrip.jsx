import { Icon } from './parts'

const PROOFS = [
  { icon: 'shield', title: 'Stok tidak pernah minus', text: 'Kunci gudang dan pembaruan bersyarat' },
  { icon: 'domain_verification', title: 'Data tiap perusahaan terpisah', text: 'Diperiksa tes otomatis lintas organisasi' },
  { icon: 'sync_saved_locally', title: 'Kirim ulang tidak menggandakan', text: 'Idempotency-Key pada perubahan stok' },
]

export default function ProofStrip() {
  return (
    <section aria-label="Jaminan utama" className="border-y border-base-300 bg-base-100">
      <ul className="mx-auto grid max-w-300 gap-5 px-4 py-6 sm:px-6 md:grid-cols-3">
        {PROOFS.map((item) => (
          <li key={item.title} className="flex items-center gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-200 text-primary">
              <Icon name={item.icon} />
            </span>
            <div>
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-xs text-base-content/60">{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
