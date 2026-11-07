import { useCallback, useEffect, useState } from 'react'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import StockAdjustModal from '../components/StockAdjustModal'
import StockReceiveModal from '../components/StockReceiveModal'
import { useAuth } from '../context/authContext'
import http from '../utils/http'
import { toast } from '../utils/toast'
import { formatNumber } from '../utils/format'
import { STATUS_LABELS, cutGroups, groupByProduct } from '../utils/stockMatrix'

const PAGE_SIZE = 100
const STATUS_BADGE = { OUT: 'badge-error', LOW: 'badge-warning', OK: 'badge-success' }
const STATUS_TEXT = { OUT: 'text-error', LOW: 'text-warning', OK: '' }

function errorText(error) {
  if (!error.response) return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.'
  if (error.response.status >= 500) return undefined
  return error.response.data?.message
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4">
      <div className="text-sm text-base-content/70">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{formatNumber(value)}</div>
    </div>
  )
}

// The pair rows of a product at the edge of a page may continue on the next or previous page, so its
// total and status are not known from this page alone.
function Unknown() {
  return (
    <span className="text-base-content/40" title="Lanjut di halaman lain">
      …
    </span>
  )
}

// A warehouse cell: the quantity, or a strip when the pair has no stock row (nothing was ever received).
function Cell({ cell, unit, unknown }) {
  if (cell) {
    return (
      <span className={STATUS_TEXT[cell.status]}>
        {formatNumber(cell.quantity)} {unit}
      </span>
    )
  }
  if (unknown) return <Unknown />
  return <span className="text-base-content/40" title="Belum ada stok di gudang ini">—</span>
}

function StockRow({ group, warehouses, unknown }) {
  const { product } = group
  return (
    <tr className={product.archived ? 'opacity-60' : ''}>
      <td>
        <div className="font-medium">
          {product.name}
          {product.archived && <span className="badge badge-ghost badge-sm ml-2">Diarsipkan</span>}
        </div>
        <div className="text-xs text-base-content/60">{product.sku}</div>
      </td>
      {warehouses.map((w) => (
        <td key={w.id} className="text-right">
          <Cell cell={group.cells[w.id]} unit={product.unit} unknown={unknown} />
        </td>
      ))}
      <td className="text-right font-semibold">
        {unknown ? <Unknown /> : `${formatNumber(group.total)} ${product.unit}`}
      </td>
      <td className="text-right text-base-content/70">
        {formatNumber(product.minStock)} {product.unit}
      </td>
      <td>
        {unknown ? (
          <Unknown />
        ) : (
          <>
            <span className={`badge badge-soft ${STATUS_BADGE[group.worst]}`}>{STATUS_LABELS[group.worst]}</span>
            {group.worst !== 'OK' && <div className="text-xs text-base-content/60">di {group.badWarehouses} gudang</div>}
          </>
        )}
      </td>
    </tr>
  )
}

// S09. Reads GET /api/stock (only the warehouses the user may access) and GET /api/warehouses (columns).
export default function StockSummary() {
  const { user } = useAuth()
  const canWrite = user?.role === 'OWNER' || user?.role === 'WAREHOUSE_ADMIN'
  // Which stock popup is open: 'receive' (P04), 'adjust' (P05) or null
  const [popup, setPopup] = useState(null)
  const [warehouses, setWarehouses] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loadedKey, setLoadedKey] = useState(null)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)

  // Wait 300 ms after typing before asking the API, and go back to page 1 for the new search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    http
      .get('/api/warehouses', { params: { pageSize: 100 } })
      .then((res) => setWarehouses(res.data.items))
      .catch((err) => setError(errorText(err) ?? 'Terjadi kesalahan. Silakan coba lagi.'))
  }, [attempt])

  useEffect(() => {
    let cancelled = false
    const key = `${q}|${warehouseId}|${status}|${page}|${attempt}`
    const params = { page, pageSize: PAGE_SIZE }
    if (q) params.q = q
    if (warehouseId) params.warehouseId = warehouseId
    if (status) params.status = status
    http
      .get('/api/stock', { params })
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err) ?? 'Terjadi kesalahan. Silakan coba lagi.')
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(key)
      })
    return () => {
      cancelled = true // a slower, older response must not overwrite a newer one
    }
  }, [q, warehouseId, status, page, attempt])

  // Loading is derived: the last finished request is not the one the current filters ask for.
  const loading = loadedKey !== `${q}|${warehouseId}|${status}|${page}|${attempt}`
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const changeFilter = (setter) => (event) => {
    setter(event.target.value)
    setPage(1)
  }

  const columns = warehouseId ? warehouses.filter((w) => w.id === warehouseId) : warehouses
  const groups = data ? groupByProduct(data.items) : []
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const { firstCut, lastCut } = cutGroups(groups, page, totalPages)
  const filtered = Boolean(q || warehouseId || status)

  // The popup owns the key (one per opening) and throws the axios error back so it shows it.
  async function receive(body, idempotencyKey) {
    const res = await http.post('/api/stock/receive', body, { headers: { 'Idempotency-Key': idempotencyKey } })
    // A replay (BL14) is the answer to an earlier identical send: nothing was added a second time.
    if (res.headers['idempotency-replayed'] === 'true') toast.info('Penerimaan ini sudah tercatat sebelumnya. Stok tidak bertambah dua kali.')
    else toast.success('Penerimaan stok berhasil dicatat.')
    setPopup(null)
    retry()
  }

  async function adjust(body, idempotencyKey) {
    const res = await http.post('/api/stock/adjust', body, { headers: { 'Idempotency-Key': idempotencyKey } })
    if (res.headers['idempotency-replayed'] === 'true') toast.info('Penyesuaian ini sudah tercatat sebelumnya. Stok tidak berubah dua kali.')
    else toast.success('Penyesuaian stok berhasil dicatat.')
    setPopup(null)
    retry()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Ringkasan stok</h1>
          <p className="text-sm text-base-content/70">
            Stok per gudang dan produk{warehouses.length > 0 && ` di ${formatNumber(warehouses.length)} gudang`}.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => setPopup('adjust')}>
              Sesuaikan stok
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setPopup('receive')}>
              Terima barang
            </button>
          </div>
        )}
      </div>
      {popup === 'receive' && <StockReceiveModal onSubmit={receive} onClose={() => setPopup(null)} />}
      {popup === 'adjust' && <StockAdjustModal onSubmit={adjust} onClose={() => setPopup(null)} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Habis" value={data?.summary.out ?? 0} tone="text-error" />
        <SummaryCard label="Menipis" value={data?.summary.low ?? 0} tone="text-warning" />
        <SummaryCard label="Cukup" value={data?.summary.ok ?? 0} tone="text-success" />
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-base-300 bg-base-100 p-4">
        <input
          type="search"
          className="input input-sm w-full sm:w-72"
          placeholder="Cari nama produk atau SKU..."
          aria-label="Cari produk"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select select-sm" aria-label="Gudang" value={warehouseId} onChange={changeFilter(setWarehouseId)}>
          <option value="">Semua gudang</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} - {w.name}
            </option>
          ))}
        </select>
        <select className="select select-sm" aria-label="Status" value={status} onChange={changeFilter(setStatus)}>
          <option value="">Semua status</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}
      {!error && loading && !data && <LoadingSkeleton rows={6} />}
      {!error && data && data.total === 0 && (
        <EmptyState
          message={filtered ? 'Tidak ada stok yang cocok dengan filter.' : 'Belum ada stok. Terima barang untuk memulai.'}
        />
      )}
      {!error && data && data.total > 0 && (
        <div className={`rounded-xl border border-base-300 bg-base-100 ${loading ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Produk &amp; SKU</th>
                  {columns.map((w) => (
                    <th key={w.id} className="text-right">
                      {w.name}
                      <div className="text-xs font-normal">{w.code}</div>
                    </th>
                  ))}
                  <th className="text-right">Total stok</th>
                  <th className="text-right">Batas minimum</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <StockRow
                    key={group.product.id}
                    group={group}
                    warehouses={columns}
                    unknown={columns.length > 1 && (group.product.id === firstCut || group.product.id === lastCut)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-base-300 p-4 text-sm">
            <span className="text-base-content/70">
              {formatNumber(data.total)} baris stok, halaman {formatNumber(page)} dari {formatNumber(totalPages)}
            </span>
            <div className="join">
              <button type="button" className="btn btn-sm join-item" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Sebelumnya
              </button>
              <button
                type="button"
                className="btn btn-sm join-item"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
