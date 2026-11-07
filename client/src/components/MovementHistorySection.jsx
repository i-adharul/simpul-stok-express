import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import EmptyState from './EmptyState'
import ErrorState from './ErrorState'
import LoadingSkeleton from './LoadingSkeleton'
import MovementDetailDrawer from './MovementDetailDrawer'
import MovementTable from './MovementTable'
import { MOVEMENT_TYPES } from '../constants/stock'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'
import { buildMovementParams } from '../utils/movementParams'
import { useStockOptions } from '../utils/useStockOptions'

const NO_FILTERS = { type: '', from: '', to: '', other: '' }

// History block of S06 (`scope` = { warehouseId }) and S08 (`scope` = { productId }). It reads
// GET /api/stock/movements with the scope fixed and the user's filters on top: newest first, an opaque
// `nextCursor` and a "Muat lebih banyak" button (BL16). `other` is the filter on the other dimension: a
// product in S06, a warehouse in S08. `refreshKey` changes after a receipt or adjustment so the list is read again.
export default function MovementHistorySection({ scope, refreshKey = 0, title = 'Riwayat' }) {
  const options = useStockOptions()
  const [filters, setFilters] = useState(NO_FILTERS)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, items: [], nextCursor: null, error: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState(null) // the movement open in P13

  const byWarehouse = 'warehouseId' in scope
  const otherKey = byWarehouse ? 'productId' : 'warehouseId'
  const scopeKey = JSON.stringify(scope)
  const params = useMemo(
    () => buildMovementParams({ ...JSON.parse(scopeKey), type: filters.type, from: filters.from, to: filters.to, [otherKey]: filters.other }),
    [scopeKey, filters, otherKey],
  )
  const requestKey = `${JSON.stringify(params)}|${attempt}|${refreshKey}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get('/api/stock/movements', { params, signal: controller.signal })
      .then(({ data }) => setState({ key: requestKey, items: data.items, nextCursor: data.nextCursor, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, items: [], nextCursor: null, error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [params, requestKey])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const { data } = await http.get('/api/stock/movements', { params: { ...params, cursor: state.nextCursor } })
      setState((s) => ({ ...s, items: [...s.items, ...data.items], nextCursor: data.nextCursor }))
    } catch (err) {
      setState((s) => ({ ...s, error: errorText(err) ?? GENERIC_ERROR }))
    } finally {
      setLoadingMore(false)
    }
  }

  const setFilter = (field) => (event) => setFilters((f) => ({ ...f, [field]: event.target.value }))
  const warehouses = new Map(options.warehouses.map((w) => [w.id, w]))
  const products = new Map(options.products.map((p) => [p.id, p]))
  const loading = state.key !== requestKey
  const filtered = Object.values(filters).some(Boolean)
  const allHistory = `/movements?${new URLSearchParams(scope)}`

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Link className="link link-primary text-sm" to={allHistory}>
          Buka di halaman riwayat
        </Link>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-base-300 bg-base-100 p-4">
        <label className="space-y-1 text-xs font-semibold">
          Dari tanggal
          <input type="date" className="input input-sm block" value={filters.from} max={filters.to || undefined} onChange={setFilter('from')} />
        </label>
        <label className="space-y-1 text-xs font-semibold">
          Sampai tanggal
          <input type="date" className="input input-sm block" value={filters.to} min={filters.from || undefined} onChange={setFilter('to')} />
        </label>
        <select className="select select-sm" aria-label="Tipe" value={filters.type} onChange={setFilter('type')}>
          <option value="">Semua tipe</option>
          {Object.entries(MOVEMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {byWarehouse ? (
          <select className="select select-sm" aria-label="Produk" value={filters.other} onChange={setFilter('other')}>
            <option value="">Semua produk</option>
            {options.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} - {p.name}
                {p.archivedAt ? ' (Diarsipkan)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <select className="select select-sm" aria-label="Gudang" value={filters.other} onChange={setFilter('other')}>
            <option value="">Semua gudang</option>
            {options.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} - {w.name}
              </option>
            ))}
          </select>
        )}
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={() => setFilters(NO_FILTERS)}>
            Hapus filter
          </button>
        )}
      </div>
      {state.error && <ErrorState message={state.error} onRetry={() => setAttempt((n) => n + 1)} />}
      {!state.error && loading && <LoadingSkeleton rows={4} />}
      {!state.error && !loading && state.items.length === 0 && (
        <EmptyState message={filtered ? 'Tidak ada pergerakan yang cocok dengan filter.' : 'Belum ada pergerakan stok.'} />
      )}
      {!state.error && !loading && state.items.length > 0 && (
        <div className="space-y-4">
          <MovementTable
            items={state.items}
            warehouses={warehouses}
            products={products}
            showProduct={byWarehouse}
            showWarehouse={!byWarehouse}
            onOpen={setSelectedId}
          />
          {state.nextCursor && (
            <div className="flex justify-center">
              <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <span className="loading loading-spinner loading-sm" /> : 'Muat lebih banyak'}
              </button>
            </div>
          )}
        </div>
      )}
      {selectedId && (
        <MovementDetailDrawer
          id={selectedId}
          typeLabel={MOVEMENT_TYPES[state.items.find((m) => m.id === selectedId)?.type]}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  )
}
