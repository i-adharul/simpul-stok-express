import { useState } from 'react'
import { Link } from 'react-router'
import ArchiveConfirmModal from '../components/ArchiveConfirmModal'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import Pagination from '../components/Pagination'
import WarehouseFormModal from '../components/WarehouseFormModal'
import { useAuth } from '../context/authContext'
import http from '../utils/http'
import { toast } from '../utils/toast'
import { usePagedList } from '../utils/usePagedList'

// S05. Every role may read; the API already limits Warehouse Admin and Viewer to their own warehouses.
// Only the Owner sees the add button and the archived toggle (the API honours includeArchived for the Owner only).
export default function Warehouses() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [includeArchived, setIncludeArchived] = useState(false)
  // null: closed; 'new': create; a warehouse row: edit that row
  const [form, setForm] = useState(null)
  // The row waiting for the P03 confirmation (archive, or restore when it is already archived)
  const [toArchive, setToArchive] = useState(null)
  const list = usePagedList('/api/warehouses', includeArchived ? { includeArchived: true } : {})
  const { data, error, loading, page, setPage, reload, resetPage } = list

  const toggleArchived = (event) => {
    setIncludeArchived(event.target.checked)
    resetPage()
  }

  // The modal stays open on failure (it shows the error and keeps what was typed); on success: toast, close, reload.
  async function save(values) {
    if (form === 'new') await http.post('/api/warehouses', values)
    else await http.patch(`/api/warehouses/${form.id}`, values)
    toast.success(form === 'new' ? 'Gudang berhasil ditambahkan.' : 'Gudang berhasil diperbarui.')
    setForm(null)
    reload()
  }

  // PATCH archived: true|false. A 409 (stock left) is thrown back to P03, which shows the server message.
  async function setArchived() {
    const restore = Boolean(toArchive.archivedAt)
    await http.patch(`/api/warehouses/${toArchive.id}`, { archived: !restore })
    toast.success(restore ? 'Gudang berhasil dipulihkan.' : 'Gudang berhasil diarsipkan.')
    setToArchive(null)
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Gudang</h1>
          <p className="text-sm text-base-content/70">Kelola lokasi penyimpanan dan operasional cabang Anda.</p>
        </div>
        {isOwner && (
          <button type="button" className="btn btn-primary" onClick={() => setForm('new')}>
            Tambah gudang
          </button>
        )}
      </div>

      {isOwner && (
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-4 py-2 text-sm">
          <input type="checkbox" className="toggle toggle-sm" checked={includeArchived} onChange={toggleArchived} />
          Tampilkan yang diarsipkan
        </label>
      )}

      {error && <ErrorState message={error} onRetry={reload} />}
      {!error && loading && !data && <LoadingSkeleton rows={5} />}
      {!error && data && data.total === 0 && (
        <EmptyState
          message={
            isOwner
              ? 'Belum ada gudang. Tambahkan gudang pertama Anda.'
              : 'Belum ada gudang yang ditugaskan kepada Anda.'
          }
          actionLabel={isOwner ? 'Tambah gudang' : undefined}
          onAction={() => setForm('new')}
        />
      )}
      {!error && data && data.total > 0 && (
        <div className={`rounded-xl border border-base-300 bg-base-100 ${loading ? 'opacity-60' : ''}`}>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama gudang</th>
                  <th>Alamat</th>
                  <th>Status</th>
                  {isOwner && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((w) => (
                  <tr key={w.id} className={w.archivedAt ? 'opacity-60' : ''}>
                    <td className="font-mono text-sm">{w.code}</td>
                    <td className="font-medium">
                      <Link className="link link-hover" to={`/warehouses/${w.id}`}>
                        {w.name}
                      </Link>
                    </td>
                    <td className="text-base-content/70">{w.address || '—'}</td>
                    <td>
                      <span className={`badge badge-soft ${w.archivedAt ? 'badge-ghost' : 'badge-success'}`}>
                        {w.archivedAt ? 'Diarsipkan' : 'Aktif'}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="text-right">
                        {!w.archivedAt && (
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setForm(w)}>
                            Ubah
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setToArchive(w)}>
                          {w.archivedAt ? 'Pulihkan' : 'Arsipkan'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} page={page} pageSize={data.pageSize} unit="gudang" onPage={setPage} />
        </div>
      )}
      {toArchive && (
        <ArchiveConfirmModal kind="gudang" name={toArchive.name} restore={Boolean(toArchive.archivedAt)} onConfirm={setArchived} onClose={() => setToArchive(null)} />
      )}
      {form && <WarehouseFormModal warehouse={form === 'new' ? null : form} onSubmit={save} onClose={() => setForm(null)} />}
    </div>
  )
}
