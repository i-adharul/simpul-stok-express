import { useLocation, useNavigate } from 'react-router'
import ErrorPage from '../components/ErrorPage'

// S23, 500. Shown for a server error and, through ErrorBoundary, for a crash while rendering.
// Never shows technical details: the server body has no stack trace either (BL29).
export default function ServerError() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const from = typeof state?.from === 'string' ? state.from : null

  // With `from` (API 500 redirect) go back to the page that failed so its request runs again.
  // Without it (ErrorBoundary keeps the URL) a full reload is the retry.
  const retry = () => (from ? navigate(from, { replace: true }) : window.location.reload())

  return (
    <ErrorPage
      status={500}
      icon="cloud_off"
      title="Terjadi kesalahan di sisi kami"
      message="Silakan coba muat ulang halaman."
    >
      <button type="button" className="btn btn-primary" onClick={retry}>
        <span className="material-symbols-outlined text-[18px]">refresh</span>
        Muat ulang halaman
      </button>
    </ErrorPage>
  )
}
