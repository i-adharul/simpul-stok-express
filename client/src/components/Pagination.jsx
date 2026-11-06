import { formatNumber } from '../utils/format'

// Footer of a list: "N item, halaman X dari Y" and the two paging buttons.
export default function Pagination({ total, page, pageSize, unit, onPage }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between border-t border-base-300 p-4 text-sm">
      <span className="text-base-content/70">
        {formatNumber(total)} {unit}, halaman {formatNumber(page)} dari {formatNumber(totalPages)}
      </span>
      <div className="join">
        <button type="button" className="btn btn-sm join-item" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Sebelumnya
        </button>
        <button type="button" className="btn btn-sm join-item" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Berikutnya
        </button>
      </div>
    </div>
  )
}
