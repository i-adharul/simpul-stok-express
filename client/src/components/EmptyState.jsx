// Empty state: one sentence and, when there is something to do, one relevant action button.
export default function EmptyState({ message, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-box border border-dashed border-base-300 bg-base-100 p-10 text-center">
      <p className="text-base-content/70">{message}</p>
      {actionLabel && (
        <button type="button" className="btn btn-primary btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
