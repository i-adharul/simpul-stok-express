import ErrorPage from '../components/ErrorPage'

// S23, 500. Shown for a server error and, through ErrorBoundary, for a crash while rendering.
// Never shows technical details: the server body has no stack trace either (BL29).
export default function ServerError() {
  return (
    <ErrorPage
      status={500}
      icon="cloud_off"
      title="Terjadi kesalahan di sisi kami"
      message="Silakan coba muat ulang halaman."
    >
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        <span className="material-symbols-outlined text-[18px]">refresh</span>
        Muat ulang halaman
      </button>
    </ErrorPage>
  )
}
