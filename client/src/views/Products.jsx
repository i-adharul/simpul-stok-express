import { useState } from 'react'
import { Link } from 'react-router'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import Pagination from '../components/Pagination'
import ProductFormModal from '../components/ProductFormModal'
import { useAuth } from '../context/authContext'
import { formatNumber } from '../utils/format'
import http from '../utils/http'
import { toast } from '../utils/toast'
import { usePagedList } from '../utils/usePagedList'

// S07. Every role may read. The products API has no search parameter, so there is no search box
// (the design shows one; the contract wins). Only the Owner may include archived products.
export default function Products() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [includeArchived, setIncludeArchived] = useState(false)
  // null: closed; 'new': create; a product row: edit that row
  const [form, setForm] = useState(null)
  const { data, error, loading, page, setPage, reload, resetPage } = usePagedList(
    '/api/products',
    includeArchived ? { includeArchived: true } : {},
  )

  const toggleArchived = (event) => {
    setIncludeArchived(event.target.checked)
    resetPage()
  }

  // The modal stays open on failure (it shows the error); on success: toast, close, reload the page.
  async function save(values) {
    if (form === 'new') await http.post('/api/products', values)
    else await http.patch(`/api/products/${form.id}`, values)
    toast.success(form === 'new' ? 'Produk berhasil ditambahkan.' : 'Produk berhasil diperbarui.')
    setForm(null)
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Produk</h1>
          <p className="text-sm text-base-content/70">Katalog produk organisasi Anda.</p>
        </div>
        {isOwner && (
          <button type="button" className="btn btn-primary" onClick={() => setForm('new')}>
            Tambah produk
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
      {!error && loading && !data && <LoadingSkeleton rows={6} />}
      {!error && data && data.total === 0 && (
        <EmptyState
          message={isOwner ? 'Belum ada produk. Tambahkan produk pertama Anda.' : 'Belum ada produk.'}
          actionLabel={isOwner ? 'Tambah produk' : undefined}
          onAction={() => setForm('new')}
        />
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
                  <th className="text-right">Batas minimum</th>
                  <th>Status</th>
                  {isOwner && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className={p.archivedAt ? 'opacity-60' : ''}>
                    <td className="font-mono text-sm">{p.sku}</td>
                    <td className="font-medium">
                      <Link className="link link-hover" to={`/products/${p.id}`}>
                        {p.name}
                      </Link>
                    </td>
                    <td>{p.unit}</td>
                    <td className="text-right">
                      {formatNumber(p.minStock)} {p.unit}
                    </td>
                    <td>
                      <span className={`badge badge-soft ${p.archivedAt ? 'badge-ghost' : 'badge-success'}`}>
                        {p.archivedAt ? 'Diarsipkan' : 'Aktif'}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="text-right">
                        {!p.archivedAt && (
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setForm(p)}>
                            Ubah
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} page={page} pageSize={data.pageSize} unit="produk" onPage={setPage} />
        </div>
      )}
      {form && <ProductFormModal product={form === 'new' ? null : form} onSubmit={save} onClose={() => setForm(null)} />}
    </div>
  )
}
