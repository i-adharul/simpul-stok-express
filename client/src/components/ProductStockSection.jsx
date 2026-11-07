import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import ErrorState from './ErrorState'
import LoadingSkeleton from './LoadingSkeleton'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatNumber } from '../utils/format'
import http from '../utils/http'
import { STATUS_LABELS } from '../utils/stockMatrix'
import { useStockOptions } from '../utils/useStockOptions'

const STATUS_BADGE = { OUT: 'badge-error', LOW: 'badge-warning', OK: 'badge-success' }
const STATUS_TEXT = { OUT: 'text-error', LOW: 'text-warning', OK: '' }

// S08, block "Stok per gudang". One row per warehouse the caller may use (GET /api/warehouses), filled from
// GET /api/stock?productId=<id>. The stock API leaves out a pair that has no stock row, so a warehouse
// without one is drawn as a strip: nothing was ever received there (docs/04). The total counts only these
// warehouses. `refreshKey` changes after a receipt so the numbers are read again.
export default function ProductStockSection({ productId, unit, refreshKey = 0 }) {
  const options = useStockOptions()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, items: [], error: null })
  const key = `${productId}|${attempt}|${refreshKey}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get('/api/stock', { params: { productId, pageSize: 100 }, signal: controller.signal })
      .then(({ data }) => setState({ key, items: data.items, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ key, items: [], error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [productId, key])

  const loading = state.key !== key || options.loading
  const error = state.error ?? options.error
  const byWarehouse = new Map(state.items.map((item) => [item.warehouse.id, item]))
  const total = state.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <section className="rounded-xl border border-base-300 bg-base-100">
      <div className="p-4">
        <h2 className="font-semibold">Stok per gudang</h2>
        <p className="text-sm text-base-content/70">Jumlah produk ini di setiap gudang yang dapat Anda akses.</p>
      </div>
      {error && (
        <div className="px-4 pb-4">
          <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      )}
      {!error && loading && (
        <div className="px-4 pb-4">
          <LoadingSkeleton rows={3} />
        </div>
      )}
      {!error && !loading && options.warehouses.length === 0 && (
        <p className="px-4 pb-4 text-sm text-base-content/60">Belum ada gudang yang dapat Anda akses.</p>
      )}
      {!error && !loading && options.warehouses.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Gudang</th>
                <th className="text-right">Jumlah</th>
                <th className="text-right">Batas minimum</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {options.warehouses.map((w) => {
                const row = byWarehouse.get(w.id)
                return (
                  <tr key={w.id}>
                    <td>
                      <Link className="link link-hover font-medium" to={`/warehouses/${w.id}`}>
                        {w.name}
                      </Link>
                      <div className="text-xs text-base-content/60">{w.code}</div>
                    </td>
                    {row ? (
                      <>
                        <td className={`text-right font-semibold ${STATUS_TEXT[row.status]}`}>
                          {formatNumber(row.quantity)} {unit}
                        </td>
                        <td className="text-right text-base-content/70">
                          {formatNumber(row.product.minStock)} {unit}
                        </td>
                        <td>
                          <span className={`badge badge-soft ${STATUS_BADGE[row.status]}`}>{STATUS_LABELS[row.status]}</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} className="text-base-content/40" title="Belum ada stok di gudang ini">
                        — Belum ada stok
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>Total seluruh gudang</th>
                <th className="text-right">
                  {formatNumber(total)} {unit}
                </th>
                <th colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
