import { Icon, SectionHeading } from './parts'

const PROBLEMS = [
  {
    icon: 'error_outline',
    tone: 'text-error',
    title: 'Saldo stok salah',
    text: 'Permintaan yang terkirim dua kali, atau pemindahan yang tercatat setengah jalan saat koneksi terputus di tengah proses.',
  },
  {
    icon: 'remove_circle_outline',
    tone: 'text-warning',
    title: 'Stok minus',
    text: 'Dua orang mengurangi unit terakhir pada saat yang sama, dan tidak ada kunci di database yang menahan salah satunya.',
  },
  {
    icon: 'visibility_off',
    tone: 'text-base-content/60',
    title: 'Tanpa jejak',
    text: 'Tidak ada catatan yang menunjukkan siapa mengubah jumlah stok, kapan, dan apa alasannya saat stok dihitung ulang.',
  },
]

export default function Problem() {
  return (
    <section aria-labelledby="masalah" className="mx-auto max-w-300 px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading id="masalah"
        eyebrow="Keandalan data"
        title="Masalah yang dicegah"
        text="Selisih stok jarang hanya soal ketelitian orang. Sering kali sistemnya membiarkan permintaan bersamaan dan perubahan yang setengah jadi."
      />
      <div className="grid gap-6 md:grid-cols-3">
        {PROBLEMS.map((item) => (
          <div key={item.title} className="rounded-box border border-base-300 bg-base-100 p-6">
            <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-base-200 ${item.tone}`}>
              <Icon name={item.icon} />
            </span>
            <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
            <p className="text-sm leading-relaxed text-base-content/70">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
