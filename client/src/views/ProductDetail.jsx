import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import ComingSoonSection from '../components/ComingSoonSection'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { UNIT_LABELS } from '../constants/units'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatDate, formatNumber } from '../utils/format'
import http from '../utils/http'
import NotFound from './NotFound'

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-sm text-base-content/70">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

// S08. GET /api/products/:id (every role). A missing, malformed or foreign id, or an archived product
// seen by a non-Owner, is a 404 (BL29): shown as the 404 page.
export default function ProductDetail() {
  const { id } = useParams()
  const [state, setState] = useState({ product: null, error: null, notFound: false })
  const [attempt, setAttempt] = useState(0)
  const [loadedKey, setLoadedKey] = useState(null)
  const key = `${id}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/products/${id}`, { signal: controller.signal })
      .then(({ data }) => {
        setState({ product: data, error: null, notFound: false })
        setLoadedKey(key)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ product: null, error: errorText(err) ?? GENERIC_ERROR, notFound: err.response?.status === 404 })
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [id, attempt, key])

  const { product, error, notFound } = state
  const loading = loadedKey !== key

  if (!loading && notFound) return <NotFound />
  return (
    <div className="space-y-6">
      <nav className="text-sm text-base-content/60">
        <Link className="link link-hover" to="/products">
          Produk
        </Link>
        {product && <span> / {product.name}</span>}
      </nav>
      {loading && !product && <LoadingSkeleton rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {product && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{product.name}</h1>
            <span className="badge badge-ghost font-mono">{product.sku}</span>
            <span className={`badge badge-soft ${product.archivedAt ? 'badge-ghost' : 'badge-success'}`}>
              {product.archivedAt ? 'Diarsipkan' : 'Aktif'}
            </span>
          </div>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4">
            <h2 className="font-semibold">Informasi produk</h2>
            <dl className="mt-2 divide-y divide-base-300">
              <InfoRow label="SKU" value={product.sku} />
              <InfoRow label="Satuan" value={UNIT_LABELS[product.unit] ?? product.unit} />
              <InfoRow label="Batas minimum (tiap gudang)" value={`${formatNumber(product.minStock)} ${product.unit}`} />
              <InfoRow label="Tanggal dibuat" value={formatDate(product.createdAt)} />
            </dl>
          </section>
          <ComingSoonSection title="Stok per gudang" message="Distribusi stok produk ini di setiap gudang akan tampil di sini." />
          <ComingSoonSection title="Riwayat produk" message="Riwayat pergerakan stok produk ini akan tampil di sini." />
        </>
      )}
    </div>
  )
}
