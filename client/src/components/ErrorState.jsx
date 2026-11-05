// Error state: a red banner with a "Coba lagi" button. `onRetry` re-runs the failed request.
export default function ErrorState({ message = 'Terjadi kesalahan. Silakan coba lagi.', onRetry }) {
  return (
    <div role="alert" className="alert alert-error alert-soft">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  )
}
