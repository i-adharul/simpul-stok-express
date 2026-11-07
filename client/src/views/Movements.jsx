import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import MovementDetailDrawer from '../components/MovementDetailDrawer'
import MovementTable from '../components/MovementTable'
import { MOVEMENT_TYPES } from '../constants/stock'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'
import { buildMovementParams } from '../utils/movementParams'
import { useStockOptions } from '../utils/useStockOptions'

const FILTER_KEYS = ['productId', 'warehouseId', 'type', 'from', 'to']

// The filters live in the URL (?warehouseId=...&type=...), so S06 and S08 can link to a filtered history
// and the browser back button keeps them.

// S10. GET /api/stock/movements: newest first, 50 per page, an opaque `nextCursor` (BL16). "Muat lebih
// banyak" asks for the next page with that cursor and appends it; changing a filter starts again.
export default function Movements() {
  const [searchParams, setSearchParams] = useSearchParams()
  const options = useStockOptions()
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, searchParams.get(key) ?? '']))
  const filtersKey = JSON.stringify(filters)
  const [state, setState] = useState({ key: null, items: [], nextCursor: null, error: null })
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [selectedId, setSelectedId] = useState(null) // the movement open in P13
  const requestKey = `${filtersKey}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get('/api/stock/movements', { params: buildMovementParams(JSON.parse(filtersKey)), signal: controller.signal })
      .then(({ data }) => setState({ key: requestKey, items: data.items, nextCursor: data.nextCursor, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, items: [], nextCursor: null, error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [filtersKey, requestKey])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const { data } = await http.get('/api/stock/movements', { params: { ...buildMovementParams(filters), cursor: state.nextCursor } })
      setState((s) => ({ ...s, items: [...s.items, ...data.items], nextCursor: data.nextCursor }))
    } catch (err) {
      setState((s) => ({ ...s, error: errorText(err) ?? GENERIC_ERROR }))
    } finally {
      setLoadingMore(false)
    }
  }

  const setFilter = (key) => (event) => {
    const next = new URLSearchParams(searchParams)
    if (event.target.value) next.set(key, event.target.value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }
  const closeDrawer = () => setSelectedId(null)
  const clearFilters = () => setSearchParams({}, { replace: true })
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const warehouses = new Map(options.warehouses.map((w) => [w.id, w]))
  const products = new Map(options.products.map((p) => [p.id, p]))
  const loading = state.key !== requestKey
  const filtered = FILTER_KEYS.some((key) => filters[key])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Riwayat pergerakan stok</h1>
        <p className="text-sm text-base-content/70">Log kronologis penerimaan, penyesuaian, mutasi, dan impor stok.</p>
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
        <select className="select select-sm" aria-label="Produk" value={filters.productId} onChange={setFilter('productId')}>
          <option value="">Semua produk</option>
          {options.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} - {p.name}
              {p.archivedAt ? ' (Diarsipkan)' : ''}
            </option>
          ))}
        </select>
        <select className="select select-sm" aria-label="Gudang" value={filters.warehouseId} onChange={setFilter('warehouseId')}>
          <option value="">Semua gudang</option>
          {options.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} - {w.name}
            </option>
          ))}
        </select>
        <select className="select select-sm" aria-label="Tipe" value={filters.type} onChange={setFilter('type')}>
          <option value="">Semua tipe</option>
          {Object.entries(MOVEMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="btn btn-ghost btn-sm text-primary" onClick={clearFilters}>
            Hapus filter
          </button>
        )}
      </div>

      {state.error && <ErrorState message={state.error} onRetry={retry} />}
      {!state.error && loading && <LoadingSkeleton rows={6} />}
      {!state.error && !loading && state.items.length === 0 && (
        <EmptyState message={filtered ? 'Tidak ada pergerakan yang cocok dengan filter.' : 'Belum ada pergerakan stok.'} />
      )}
      {!state.error && !loading && state.items.length > 0 && (
        <div className="space-y-4">
          <MovementTable items={state.items} warehouses={warehouses} products={products} onOpen={setSelectedId} />
          <div className="flex flex-col items-center gap-2">
            {state.nextCursor && (
              <button type="button" className="btn" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <span className="loading loading-spinner loading-sm" /> : 'Muat lebih banyak'}
              </button>
            )}
            <p className="text-xs text-base-content/60">Riwayat tidak dapat diubah.</p>
          </div>
        </div>
      )}
      {selectedId && (
        <MovementDetailDrawer
          id={selectedId}
          typeLabel={MOVEMENT_TYPES[state.items.find((m) => m.id === selectedId)?.type]}
          onClose={closeDrawer}
        />
      )}
    </div>
  )
}
