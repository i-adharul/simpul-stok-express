import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import ArchiveConfirmModal from '../components/ArchiveConfirmModal'
import AssignUsersModal from '../components/AssignUsersModal'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import MovementHistorySection from '../components/MovementHistorySection'
import StockAdjustModal from '../components/StockAdjustModal'
import StockReceiveModal from '../components/StockReceiveModal'
import WarehouseFormModal from '../components/WarehouseFormModal'
import WarehouseStockSection from '../components/WarehouseStockSection'
import { useAuth } from '../context/authContext'
import { ROLE_LABELS } from '../constants/navigation'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'
import { toast } from '../utils/toast'
import NotFound from './NotFound'

// S06. GET /api/warehouses/:id returns the warehouse plus `assignedUsers` (active users, no emails).
// A missing, foreign or (for non-Owners) archived warehouse is a 404; an unassigned Warehouse Admin or
// Viewer gets 403, which the http interceptor already turns into the forbidden page.
export default function WarehouseDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  // Owner and Warehouse Admin may change stock (the API checks again); a Viewer only reads.
  const canWrite = isOwner || user?.role === 'WAREHOUSE_ADMIN'
  // Bumped after a receipt or adjustment so the stock and history blocks read again.
  const [stockVersion, setStockVersion] = useState(0)
  // Which popup is open: 'edit' (P01), 'archive' (P03), 'assign' (P06), 'receive' (P04) or 'adjust' (P05)
  const [popup, setPopup] = useState(null)
  const [state, setState] = useState({ id: null, warehouse: null, error: null, notFound: false })
  const [attempt, setAttempt] = useState(0)
  const key = `${id}|${attempt}`
  const [loadedKey, setLoadedKey] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/warehouses/${id}`, { signal: controller.signal })
      .then(({ data }) => {
        setState({ warehouse: data, error: null, notFound: false })
        setLoadedKey(key)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ warehouse: null, error: errorText(err) ?? GENERIC_ERROR, notFound: err.response?.status === 404 })
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [id, attempt, key])

  const { warehouse, error, notFound } = state
  const reload = () => setAttempt((n) => n + 1)

  // Each popup throws the axios error back to itself, which shows it; on success: toast, close, reload.
  async function saveForm(values) {
    await http.patch(`/api/warehouses/${id}`, values)
    toast.success('Gudang berhasil diperbarui.')
    setPopup(null)
    reload()
  }

  async function setArchived() {
    const restore = Boolean(warehouse.archivedAt)
    await http.patch(`/api/warehouses/${id}`, { archived: !restore })
    toast.success(restore ? 'Gudang berhasil dipulihkan.' : 'Gudang berhasil diarsipkan.')
    setPopup(null)
    reload()
  }

  // The popups own the Idempotency-Key (one per opening) and throw the axios error back so they show it.
  async function sendStock(path, body, idempotencyKey, messages) {
    const res = await http.post(path, body, { headers: { 'Idempotency-Key': idempotencyKey } })
    // A replay (BL14) answers an earlier identical send: nothing was applied a second time.
    toast[res.headers['idempotency-replayed'] === 'true' ? 'info' : 'success'](
      res.headers['idempotency-replayed'] === 'true' ? messages.replayed : messages.done,
    )
    setPopup(null)
    setStockVersion((n) => n + 1)
  }
  const receive = (body, key) =>
    sendStock('/api/stock/receive', body, key, {
      done: 'Penerimaan stok berhasil dicatat.',
      replayed: 'Penerimaan ini sudah tercatat sebelumnya. Stok tidak bertambah dua kali.',
    })
  const adjust = (body, key) =>
    sendStock('/api/stock/adjust', body, key, {
      done: 'Penyesuaian stok berhasil dicatat.',
      replayed: 'Penyesuaian ini sudah tercatat sebelumnya. Stok tidak berubah dua kali.',
    })
  const loading = loadedKey !== key

  if (!loading && notFound) return <NotFound />
  return (
    <div className="space-y-6">
      <nav className="text-sm text-base-content/60">
        <Link className="link link-hover" to="/warehouses">
          Gudang
        </Link>
        {warehouse && <span> / {warehouse.name}</span>}
      </nav>
      {loading && !warehouse && <LoadingSkeleton rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {warehouse && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{warehouse.name}</h1>
              <span className="badge badge-ghost font-mono">{warehouse.code}</span>
              <span className={`badge badge-soft ${warehouse.archivedAt ? 'badge-ghost' : 'badge-success'}`}>
                {warehouse.archivedAt ? 'Diarsipkan' : 'Aktif'}
              </span>
            </div>
            <p className="mt-1 text-sm text-base-content/70">{warehouse.address || 'Alamat belum diisi.'}</p>
            {canWrite && !warehouse.archivedAt && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setPopup('receive')}>
                  Terima barang
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setPopup('adjust')}>
                  Sesuaikan stok
                </button>
              </div>
            )}
            {isOwner && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!warehouse.archivedAt && (
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => setPopup('edit')}>
                      Ubah gudang
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setPopup('assign')}>
                      Tugaskan pengguna
                    </button>
                  </>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setPopup('archive')}>
                  {warehouse.archivedAt ? 'Pulihkan gudang' : 'Arsipkan gudang'}
                </button>
              </div>
            )}
          </div>
          <AssignedUsers users={warehouse.assignedUsers} />
          <WarehouseStockSection warehouseId={warehouse.id} archived={Boolean(warehouse.archivedAt)} refreshKey={stockVersion} />
          <MovementHistorySection scope={{ warehouseId: warehouse.id }} refreshKey={stockVersion} title="Riwayat gudang" />
          {popup === 'receive' && <StockReceiveModal warehouseId={warehouse.id} onSubmit={receive} onClose={() => setPopup(null)} />}
          {popup === 'adjust' && <StockAdjustModal warehouseId={warehouse.id} onSubmit={adjust} onClose={() => setPopup(null)} />}
          {popup === 'edit' && <WarehouseFormModal warehouse={warehouse} onSubmit={saveForm} onClose={() => setPopup(null)} />}
          {popup === 'archive' && (
            <ArchiveConfirmModal kind="gudang" name={warehouse.name} restore={Boolean(warehouse.archivedAt)} onConfirm={setArchived} onClose={() => setPopup(null)} />
          )}
          {popup === 'assign' && (
            <AssignUsersModal
              warehouse={warehouse}
              onSaved={() => {
                setPopup(null)
                reload()
              }}
              onClose={() => setPopup(null)}
            />
          )}
        </>
      )}
    </div>
  )
}

// Who is responsible for this warehouse (BL10). The list is empty when nobody is assigned.
function AssignedUsers({ users }) {
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4">
      <h2 className="font-semibold">Penanggung jawab</h2>
      {users.length === 0 ? (
        <p className="mt-2 text-sm text-base-content/70">Belum ada pengguna yang ditugaskan.</p>
      ) : (
        <ul className="mt-2 divide-y divide-base-300">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{u.name}</span>
              <span className="badge badge-soft badge-sm">{ROLE_LABELS[u.role] ?? u.role}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
