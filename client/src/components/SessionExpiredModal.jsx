import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../context/authContext'

// P19. Global and not dismissible: the only way out is the button, because the token is already gone.
export default function SessionExpiredModal() {
  const { sessionExpired, dismissSessionExpired } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // On the login page there is nothing to lose; the form is already the next step.
  if (!sessionExpired || pathname === '/login') return null

  function handleClick() {
    dismissSessionExpired()
    navigate('/login', { replace: true })
  }

  return (
    <dialog className="modal modal-open" role="alertdialog" aria-modal="true" aria-labelledby="session-expired-title">
      <div className="modal-box max-w-95 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-base-300 bg-base-200 text-primary">
          <span className="material-symbols-outlined">schedule</span>
        </div>
        <h2 id="session-expired-title" className="mb-2 text-lg font-semibold">
          Sesi Anda telah berakhir
        </h2>
        <p className="mb-6 text-sm text-base-content/70">Silakan masuk lagi untuk melanjutkan.</p>
        <button type="button" className="btn btn-primary w-full" onClick={handleClick} autoFocus>
          Masuk lagi
        </button>
      </div>
    </dialog>
  )
}
