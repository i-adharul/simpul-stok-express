import { SectionHeading, Shot } from './parts'

const STEPS = [
  {
    no: '01',
    title: 'Terima stok',
    text: 'Catat barang masuk ke sebuah gudang. Jumlah harus bilangan bulat positif dan server menolak yang lain.',
    shot: 'dashboard',
    alt: 'Dashboard dengan tombol Terima barang dan Sesuaikan stok',
  },
  {
    no: '02',
    title: 'Pindahkan antar gudang',
    text: 'Pilih gudang asal dan tujuan, lalu produk dan jumlahnya. Pengurangan dan penambahan terjadi dalam satu transaksi.',
    shot: 'mutasi',
    alt: 'Formulir buat mutasi stok dari satu gudang ke gudang lain',
  },
  {
    no: '03',
    title: 'Telusuri riwayatnya',
    text: 'Lihat setiap perubahan stok menurut waktu, tipe, produk, dan gudang. Catatan lama tidak bisa diubah.',
    shot: 'riwayat',
    alt: 'Daftar riwayat pergerakan stok dengan filter tanggal, produk, gudang, dan tipe',
  },
]

export default function HowItWorks() {
  return (
    <section id="cara-kerja" aria-labelledby="cara-kerja-judul" className="mx-auto max-w-300 px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading id="cara-kerja-judul" center title="Cara kerja" text="Tiga langkah dalam alur harian." />
      <ol className="grid gap-6 md:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.no} className="flex flex-col overflow-hidden rounded-box border border-base-300 bg-base-100">
            <div className="p-6">
              <span className="mb-3 block font-mono text-2xl font-extrabold text-base-300">{step.no}</span>
              <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-base-content/70">{step.text}</p>
            </div>
            <div className="mt-auto h-44 overflow-hidden border-t border-base-300 bg-base-200">
              <Shot name={step.shot} alt={step.alt} className="object-cover object-top" />
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
