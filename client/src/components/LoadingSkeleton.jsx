// Loading state: grey placeholder rows (docs: "Loading: a skeleton").
export default function LoadingSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Memuat data">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10 w-full" />
      ))}
    </div>
  )
}
