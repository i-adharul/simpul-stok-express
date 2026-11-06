import ErrorPage, { BackButton, DashboardButton } from '../components/ErrorPage'

// S23, 404. Also shown for a resource that belongs to another organization (BL29: never 403).
export default function NotFound() {
  return (
    <ErrorPage
      status={404}
      icon="search_off"
      title="Halaman tidak ditemukan"
      message="Tautan atau halaman yang Anda cari mungkin sudah dipindahkan, dihapus, atau alamat URL salah ketik."
    >
      <DashboardButton />
      <BackButton />
    </ErrorPage>
  )
}
