import { Icon } from './parts'

// "Siapa yang membuat ini?" is kept neutral on purpose: the maintainer writes the answer.
const QUESTIONS = [
  {
    q: 'Ini produk nyata?',
    a: 'Bukan. Ini proyek portofolio untuk menunjukkan rancangan sistem stok multi-gudang. Kodenya terbuka di GitHub.',
  },
  {
    q: 'Apakah data demo aman?',
    a: 'Data demo bersifat publik dan direset berkala. Jangan memasukkan data pribadi, rahasia usaha, atau informasi sensitif.',
  },
  {
    q: 'Apakah pembayarannya sungguhan?',
    a: 'Tidak. Pembayaran hanya berjalan di mode sandbox, jadi tidak ada penagihan sungguhan.',
  },
  {
    q: 'Siapa yang membuat ini?',
    a: 'Simpul Stok dibuat dan dikelola oleh Adharul Imron sebagai proyek portofolio teknis. Kode sumbernya terbuka di GitHub, termasuk tes dan catatan keputusan desainnya.',
  },
]

export default function Faq() {
  return (
    <section aria-labelledby="faq-judul" className="mx-auto max-w-200 border-t border-base-300 px-4 py-16 sm:px-6">
      <h2 id="faq-judul" className="mb-8 text-center text-2xl font-bold tracking-tight sm:text-3xl">
        Pertanyaan umum
      </h2>
      <div className="space-y-4">
        {QUESTIONS.map((item) => (
          <details key={item.q} className="group rounded-box border border-base-300 bg-base-100 p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
              <span>{item.q}</span>
              <Icon name="expand_more" className="text-base-content/60 transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-3 border-t border-base-300 pt-3 text-sm leading-relaxed text-base-content/70">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
