import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import MovementDetailDrawer from '../components/MovementDetailDrawer'
import { ROLE_LABELS } from '../constants/navigation'
import { MOVEMENT_TYPES } from '../constants/stock'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatDateTime, formatNumber } from '../utils/format'
import http from '../utils/http'
import NotFound from './NotFound'

function WarehouseCard({ title, warehouse }) {
  return (
    <div className="flex-1 rounded-xl border border-base-300 bg-base-200/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase text-base-content/60">{title}</div>
        <span className="badge badge-ghost font-mono">{warehouse.code}</span>
      </div>
      <div className="mt-1 font-semibold">{warehouse.name}</div>
      <div className="text-sm text-base-content/70">{warehouse.address ?? '—'}</div>
    </div>
  )
}

// A movement ID is null when its warehouse is not one the caller may see (docs/04): P13 would answer 404
// for it, so no button is offered. The two movements of an item are the out (source) and the in (destination).
function MovementButton({ id, label, onOpen }) {
  if (!id) return <span className="text-base-content/40">—</span>
  return (
    <button type="button" className="btn btn-xs btn-ghost text-primary" onClick={() => onOpen(id)}>
      {label}
    </button>
  )
}

function ItemsTable({ items, onOpen }) {
  return (
    <section className="rounded-xl border border-base-300">
      <div className="flex items-center justify-between border-b border-base-300 p-4">
        <h2 className="font-semibold">Daftar item mutasi</h2>
        <span className="text-sm text-base-content/60">{formatNumber(items.length)} item</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>No</th>
              <th>SKU</th>
              <th>Nama produk</th>
              <th className="text-right">Jumlah</th>
              <th>Satuan</th>
              <th>Pergerakan</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.productId}>
                <td>{index + 1}</td>
                <td className="font-mono text-sm">{item.sku}</td>
                <td>{item.name}</td>
                <td className="text-right font-semibold">{formatNumber(item.quantity)}</td>
                <td>{item.unit}</td>
                <td className="whitespace-nowrap">
                  <MovementButton id={item.outMovementId} label={MOVEMENT_TYPES.TRANSFER_OUT} onOpen={onOpen} />
                  <MovementButton id={item.inMovementId} label={MOVEMENT_TYPES.TRANSFER_IN} onOpen={onOpen} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// S12. GET /api/stock/transfers/:id (every tenant role; visible when the caller may see the source OR the
// destination warehouse). A malformed, missing, foreign or out-of-reach id is one and the same 404 (docs/04),
// shown as the 404 page.
export default function TransferDetail() {
  const { id } = useParams()
  const [state, setState] = useState({ transfer: null, error: null, notFound: false })
  const [attempt, setAttempt] = useState(0)
  const [loadedKey, setLoadedKey] = useState(null)
  const [selected, setSelected] = useState(null) // movement ID shown in P13
  const key = `${id}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/stock/transfers/${id}`, { signal: controller.signal })
      .then(({ data }) => {
        setState({ transfer: data, error: null, notFound: false })
        setLoadedKey(key)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ transfer: null, error: errorText(err) ?? GENERIC_ERROR, notFound: err.response?.status === 404 })
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [id, attempt, key])

  const closeDrawer = useCallback(() => setSelected(null), [])
  const { transfer, error, notFound } = state
  const loading = loadedKey !== key

  if (!loading && notFound) return <NotFound />
  const selectedType = transfer?.items.some((i) => i.outMovementId === selected) ? 'TRANSFER_OUT' : 'TRANSFER_IN'
  return (
    <div className="space-y-6">
      <nav className="text-sm text-base-content/60">
        <Link className="link link-hover" to="/movements">
          Riwayat
        </Link>
        {transfer && <span> / {transfer.code}</span>}
      </nav>
      {loading && !transfer && <LoadingSkeleton rows={5} />}
      {!loading && error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {transfer && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">Mutasi stok {transfer.code}</h1>
            <span className="badge badge-soft badge-success">Selesai</span>
          </div>
          <p className="text-sm text-base-content/70">
            {formatDateTime(transfer.createdAt)} • Dibuat oleh:{' '}
            {transfer.createdBy ? (
              <span className="font-medium">
                {transfer.createdBy.name} ({ROLE_LABELS[transfer.createdBy.role] ?? transfer.createdBy.role})
              </span>
            ) : (
              'Sistem'
            )}
          </p>
          <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
            <WarehouseCard title="Dari (gudang asal)" warehouse={transfer.fromWarehouse} />
            <span aria-hidden="true" className="material-symbols-outlined self-center text-primary md:rotate-0 rotate-90">
              arrow_forward
            </span>
            <WarehouseCard title="Ke (gudang tujuan)" warehouse={transfer.toWarehouse} />
          </div>
          <ItemsTable items={transfer.items} onOpen={setSelected} />
          <section>
            <h2 className="text-xs font-semibold uppercase text-base-content/60">Catatan mutasi</h2>
            <div className="mt-1 rounded-xl border border-base-300 bg-base-200/50 p-3">
              {transfer.note ?? <span className="text-base-content/60">Tidak ada catatan.</span>}
            </div>
          </section>
          <p className="text-sm text-base-content/70">Mutasi ini selesai secara instan dan riwayatnya tercatat permanen.</p>
          {selected && <MovementDetailDrawer id={selected} typeLabel={MOVEMENT_TYPES[selectedType]} onClose={closeDrawer} />}
        </>
      )}
    </div>
  )
}
