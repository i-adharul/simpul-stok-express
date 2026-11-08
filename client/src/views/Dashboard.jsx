import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import StockAdjustModal from '../components/StockAdjustModal'
import StockReceiveModal from '../components/StockReceiveModal'
import { MOVEMENT_TYPES } from '../constants/stock'
import { useAuth } from '../context/authContext'
import { errorText, GENERIC_ERROR } from '../utils/apiError'
import { formatDateTime, formatLongDate, formatNumber, greetingFor } from '../utils/format'
import http from '../utils/http'
import { toast } from '../utils/toast'

const STATUS_BADGE = { OUT: 'badge-error', LOW: 'badge-warning' }
const STATUS_TEXT = { OUT: 'text-error', LOW: 'text-warning' }
const STATUS_LABEL = { OUT: 'Habis', LOW: 'Menipis' }

function SummaryCard({ label, value, tone = '', hint }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4">
      <div className="text-sm text-base-content/70">{label}</div>
      <div className={`text-3xl font-bold ${tone}`}>{formatNumber(value)}</div>
      <div className="text-xs text-base-content/60">{hint}</div>
    </div>
  )
}

function SummaryCards({ summary }) {
  const { totalProducts, totalUnits, lowCount, outCount, movementsToday } = summary
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label="Total produk" value={totalProducts} hint="Produk aktif" />
      <SummaryCard label="Total unit stok" value={totalUnits} hint="Di semua gudang Anda" />
      <SummaryCard
        label="Stok menipis"
        value={lowCount}
        tone="text-warning"
        hint={`${formatNumber(outCount)} produk habis`}
      />
      <SummaryCard label="Mutasi hari ini" value={movementsToday} hint="Semua pergerakan stok" />
    </div>
  )
}

function RestockCard({ restock }) {
  return (
    <section className="rounded-xl border border-base-300 bg-base-100">
      <div className="border-b border-base-300 p-4">
        <h2 className="text-lg font-semibold">Perlu diisi ulang</h2>
        <p className="text-sm text-base-content/70">Produk di bawah batas stok minimum</p>
      </div>
      {restock.total === 0 ? (
        <p className="p-6 text-center text-sm text-base-content/70">Semua stok di atas batas minimum.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Gudang</th>
                <th className="text-right">Stok saat ini</th>
                <th className="text-right">Batas min</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {restock.items.map(({ warehouse, product, quantity, status }) => (
                <tr key={`${warehouse.id}-${product.id}`}>
                  <td>
                    <div className="font-medium">{product.name}</div>
                    <div className="text-xs text-base-content/60">{product.sku}</div>
                  </td>
                  <td>
                    <span className="badge badge-ghost">{warehouse.name}</span>
                  </td>
                  <td className={`text-right font-semibold ${STATUS_TEXT[status]}`}>
                    {formatNumber(quantity)} {product.unit}
                  </td>
                  <td className="text-right text-base-content/70">
                    {formatNumber(product.minStock)} {product.unit}
                  </td>
                  <td>
                    <span className={`badge badge-soft ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-base-300 p-4 text-sm">
        <span className="text-base-content/70">
          Menampilkan {formatNumber(restock.items.length)} dari {formatNumber(restock.total)} yang perlu diisi ulang
        </span>
        <Link to="/stock" className="btn btn-sm">
          Lihat ringkasan stok
        </Link>
      </div>
    </section>
  )
}

function ActivityItem({ movement }) {
  const { type, quantityDelta, reason, createdAt, warehouse, product, createdBy, transfer } = movement
  return (
    <li className="space-y-0.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{MOVEMENT_TYPES[type]}</span>
        <span className="whitespace-nowrap text-xs text-base-content/60">{formatDateTime(createdAt)}</span>
      </div>
      <p className="text-sm">
        <span className={`font-semibold ${quantityDelta < 0 ? 'text-error' : 'text-success'}`}>
          {quantityDelta > 0 && '+'}
          {formatNumber(quantityDelta)} {product.unit}
        </span>{' '}
        {product.name} di {warehouse.name}
      </p>
      <p className="text-xs text-base-content/60">
        Oleh: {createdBy?.name ?? '—'}
        {transfer && (
          <>
            {' • '}
            <Link to={`/transfers/${transfer.id}`} className="link">
              {transfer.code}
            </Link>
          </>
        )}
        {reason && ` • Alasan: ${reason}`}
      </p>
    </li>
  )
}

function ActivityCard({ items }) {
  return (
    <section className="rounded-xl border border-base-300 bg-base-100">
      <div className="border-b border-base-300 p-4">
        <h2 className="text-lg font-semibold">Aktivitas terbaru</h2>
        <p className="text-sm text-base-content/70">Riwayat pergerakan stok terkini</p>
      </div>
      {items.length === 0 ? (
        <p className="p-6 text-center text-sm text-base-content/70">Belum ada pergerakan stok.</p>
      ) : (
        <ul className="divide-y divide-base-300 px-4">
          {items.map((movement) => (
            <ActivityItem key={movement.id} movement={movement} />
          ))}
        </ul>
      )}
      <div className="border-t border-base-300 p-4 text-center text-sm">
        {/* S10 for every role for now; the Owner goes to the audit log (S18) once that screen exists. */}
        <Link to="/movements" className="link link-primary font-semibold">
          Lihat log aktivitas lengkap
        </Link>
      </div>
    </section>
  )
}

// S04. One request (GET /api/dashboard) fills every block; the API already limits the figures to the
// warehouses the caller may see.
export default function Dashboard() {
  const { user } = useAuth()
  const canWrite = user?.role === 'OWNER' || user?.role === 'WAREHOUSE_ADMIN'
  // Which stock popup is open: 'receive' (P04), 'adjust' (P05) or null
  const [popup, setPopup] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [now] = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    http
      .get('/api/dashboard')
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err) ?? GENERIC_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  // The popup owns the idempotency key (one per opening) and throws the axios error back so it shows it.
  async function receive(body, idempotencyKey) {
    const res = await http.post('/api/stock/receive', body, { headers: { 'Idempotency-Key': idempotencyKey } })
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
          <h1 className="text-2xl font-bold">
            {greetingFor(now)}, {user?.name?.split(' ')[0]}
          </h1>
          <p className="text-sm text-base-content/70">{formatLongDate(now)} • Ringkasan operasional</p>
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

      {error && <ErrorState message={error} onRetry={retry} />}
      {!error && !data && <LoadingSkeleton rows={4} />}
      {!error && data && data.summary.totalProducts === 0 && (
        <EmptyState message="Belum ada produk. Tambahkan produk untuk memulai." />
      )}
      {!error && data && (
        <>
          <SummaryCards summary={data.summary} />
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <RestockCard restock={data.restock} />
            <ActivityCard items={data.recentActivity} />
          </div>
        </>
      )}
    </div>
  )
}
