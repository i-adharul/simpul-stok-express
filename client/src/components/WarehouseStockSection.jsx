import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import EmptyState from './EmptyState'
import ErrorState from './ErrorState'
import LoadingSkeleton from './LoadingSkeleton'
import Pagination from './Pagination'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatNumber } from '../utils/format'
import http from '../utils/http'
import { STATUS_LABELS } from '../utils/stockMatrix'

const PAGE_SIZE = 20
const STATUS_BADGE = { OUT: 'badge-error', LOW: 'badge-warning', OK: 'badge-success' }
const STATUS_TEXT = { OUT: 'text-error', LOW: 'text-warning', OK: '' }

function SummaryCard({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4">
      <div className="text-sm text-base-content/70">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{formatNumber(value)}</div>
    </div>
  )
}

function StockRow({ row }) {
  const { product } = row
  return (
    <tr className={product.archived ? 'opacity-60' : ''}>
      <td className="font-mono text-sm">{product.sku}</td>
      <td>
        <Link className="link link-hover font-medium" to={`/products/${product.id}`}>
          {product.name}
        </Link>
        {product.archived && <span className="badge badge-ghost badge-sm ml-2">Diarsipkan</span>}
      </td>
      <td>{product.unit}</td>
      <td className={`text-right font-semibold ${STATUS_TEXT[row.status]}`}>{formatNumber(row.quantity)}</td>
      <td className="text-right text-base-content/70">{formatNumber(product.minStock)}</td>
      <td>
        <span className={`badge badge-soft ${STATUS_BADGE[row.status]}`}>{STATUS_LABELS[row.status]}</span>
      </td>
    </tr>
  )
}

// S06, block "Stok". GET /api/stock?warehouseId=<id> returns only the pairs that have a stock row, so a
// product that was never received here is not listed. `refreshKey` changes after a receipt or adjustment so
// the list is read again. An archived warehouse is not asked at all: the API answers 403 for it (it is not
// in the caller's reach), and an archived warehouse holds no stock anyway (BL08).
export default function WarehouseStockSection({ warehouseId, archived, refreshKey = 0 }) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, data: null, error: null })
  const key = `${warehouseId}|${q}|${status}|${page}|${attempt}|${refreshKey}`

  // Wait 300 ms after typing before asking the API, and go back to page 1 for the new search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (archived) return undefined
    const controller = new AbortController()
    const params = { warehouseId, page, pageSize: PAGE_SIZE }
    if (q) params.q = q
    if (status) params.status = status
    http
      .get('/api/stock', { params, signal: controller.signal })
      .then(({ data }) => setState({ key, data, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ key, data: null, error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [warehouseId, archived, q, status, page, key])

  if (archived) {
    return (
      <section className="rounded-xl border border-dashed border-base-300 bg-base-100 p-4">
        <h2 className="font-semibold">Stok</h2>
        <p className="mt-2 text-sm text-base-content/60">Gudang ini diarsipkan, jadi stoknya tidak ditampilkan.</p>
      </section>
    )
  }

  const { data, error } = state
  const loading = state.key !== key
  const filtered = Boolean(q || status)
  const changeStatus = (event) => {
    setStatus(event.target.value)
    setPage(1)
  }

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Stok</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Habis" value={data?.summary.out ?? 0} tone="text-error" />
        <SummaryCard label="Menipis" value={data?.summary.low ?? 0} tone="text-warning" />
        <SummaryCard label="Cukup" value={data?.summary.ok ?? 0} tone="text-success" />
      </div>
      <div className="flex flex-wrap gap-3 rounded-xl border border-base-300 bg-base-100 p-4">
        <input
          type="search"
          className="input input-sm w-full sm:w-72"
          placeholder="Cari produk atau SKU di gudang ini..."
          aria-label="Cari produk di gudang ini"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select select-sm" aria-label="Status stok" value={status} onChange={changeStatus}>
          <option value="">Semua status</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {!error && loading && !data && <LoadingSkeleton rows={4} />}
      {!error && data && data.total === 0 && (
        <EmptyState message={filtered ? 'Tidak ada stok yang cocok dengan filter.' : 'Belum ada stok di gudang ini. Terima barang untuk memulai.'} />
      )}
      {!error && data && data.total > 0 && (
        <div className={`rounded-xl border border-base-300 bg-base-100 ${loading ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nama produk</th>
                  <th>Satuan</th>
                  <th className="text-right">Stok saat ini</th>
                  <th className="text-right">Batas minimum</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <StockRow key={row.product.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} page={page} pageSize={PAGE_SIZE} unit="produk" onPage={setPage} />
        </div>
      )}
    </section>
  )
}
