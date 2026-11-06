import { useState } from 'react'
import { Link } from 'react-router'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import Pagination from '../components/Pagination'
import { useAuth } from '../context/authContext'
import { formatNumber } from '../utils/format'
import { usePagedList } from '../utils/usePagedList'

// S07. Every role may read. The products API has no search parameter, so there is no search box
// (the design shows one; the contract wins). Only the Owner may include archived products.
export default function Products() {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [includeArchived, setIncludeArchived] = useState(false)
  const { data, error, loading, page, setPage, reload, resetPage } = usePagedList(
    '/api/products',
    includeArchived ? { includeArchived: true } : {},
  )

  const toggleArchived = (event) => {
    setIncludeArchived(event.target.checked)
    resetPage()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Produk</h1>
        <p className="text-sm text-base-content/70">Katalog produk organisasi Anda.</p>
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
        <EmptyState message={isOwner ? 'Belum ada produk. Tambahkan produk pertama Anda.' : 'Belum ada produk.'} />
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={data.total} page={page} pageSize={data.pageSize} unit="produk" onPage={setPage} />
        </div>
      )}
    </div>
  )
}
