import { GITHUB_URL } from '../../constants/landing'
import { Icon, SectionHeading } from './parts'

// Every claim here is backed by code and a test in the repository; do not add one that is not.
const EVIDENCE = [
  {
    title: 'Stok tidak pernah minus',
    text: 'Setiap perubahan stok mengunci gudangnya lebih dulu (SELECT ... FOR UPDATE), lalu mengurangi dengan pembaruan bersyarat. Tes menjalankan permintaan bersamaan dan memeriksa saldo tidak pernah di bawah nol.',
  },
  {
    title: 'Mutasi utuh atau batal',
    text: 'Pengurangan di gudang asal dan penambahan di gudang tujuan berjalan dalam satu transaksi database. Kedua gudang dikunci berurutan menurut ID supaya tidak saling menunggu.',
  },
  {
    title: 'Kirim ulang tidak menggandakan',
    text: 'Setiap perubahan stok wajib membawa Idempotency-Key. Kunci yang sama tidak mengulang efeknya, dan keunikan kunci dijaga oleh database.',
  },
  {
    title: 'Data tiap perusahaan terpisah',
    text: 'Semua organisasi berbagi satu skema, dan setiap baris data membawa kolom organizationId. Data dibaca lewat tenantScope, dan tes otomatis lintas organisasi mencocokkan semua rute yang terdaftar.',
  },
]

const FLOW = [
  { icon: 'desktop_windows', title: 'React', text: 'Vercel' },
  { icon: 'dns', title: 'Express API', text: 'EC2' },
  { icon: 'database', title: 'PostgreSQL', text: 'Supabase' },
]

const STACK = ['Express.js', 'PostgreSQL', 'Sequelize', 'React + Tailwind']

export default function BehindTheScenes() {
  return (
    <section id="di-balik-layar" aria-labelledby="di-balik-layar-judul" className="scroll-mt-16 border-t border-stone-800 bg-[#18181b] py-16 text-[#faf8f5] sm:py-20">
      <div className="mx-auto max-w-300 px-4 sm:px-6">
        <SectionHeading
          id="di-balik-layar-judul"
          dark
          eyebrow="Rekayasa"
          title="Di balik layar"
          text="Keputusan teknis yang menjaga stok tetap benar saat ada permintaan bersamaan dan koneksi yang tidak stabil."
        />
        <div className="mb-10 grid gap-6 md:grid-cols-2">
          {EVIDENCE.map((item) => (
            <div key={item.title} className="rounded-box border border-stone-800 bg-[#202024] p-6">
              <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
                <Icon name="check_circle" className="text-[20px] text-[#a594fd]" />
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-stone-400">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mb-10 rounded-box border border-stone-800 bg-[#202024] p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-stone-400">Alur data</p>
          <ul className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {FLOW.map((node, index) => (
              <li key={node.title} className="flex flex-1 flex-col items-center gap-3 sm:flex-row">
                <div className="w-full flex-1 rounded-lg border border-stone-700 bg-stone-900 p-3 text-center">
                  <Icon name={node.icon} className="mb-1 text-stone-300" />
                  <p className="text-sm font-medium text-stone-200">{node.title}</p>
                  <p className="text-xs text-stone-500">{node.text}</p>
                </div>
                {index < FLOW.length - 1 && <Icon name="arrow_forward" className="rotate-90 text-stone-600 sm:rotate-0" />}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col items-start justify-between gap-6 border-t border-stone-800 pt-6 sm:flex-row sm:items-center">
          <ul className="flex flex-wrap gap-2">
            {STACK.map((name) => (
              <li key={name} className="rounded-md border border-stone-700 bg-stone-800 px-2.5 py-1 font-mono text-xs text-stone-300">
                {name}
              </li>
            ))}
          </ul>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn btn-outline border-stone-700 text-white hover:border-stone-500 hover:bg-transparent">
            <Icon name="terminal" className="text-[18px]" />
            Lihat kode dan keputusan teknis di GitHub
          </a>
        </div>
      </div>
    </section>
  )
}
