import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import MovementHistorySection from '../components/MovementHistorySection'
import ProductStockSection from '../components/ProductStockSection'
import StockReceiveModal from '../components/StockReceiveModal'
import { useAuth } from '../context/authContext'
import { UNIT_LABELS } from '../constants/units'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatDate, formatNumber } from '../utils/format'
import http from '../utils/http'
import { toast } from '../utils/toast'
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
  const { user } = useAuth()
  // Owner and Warehouse Admin may receive stock (the API checks again); a Viewer only reads.
  const canWrite = user?.role === 'OWNER' || user?.role === 'WAREHOUSE_ADMIN'
  const [receiving, setReceiving] = useState(false) // P04 open
  const [stockVersion, setStockVersion] = useState(0) // bumped after a receipt so stock and history reload
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

  // The popup owns the Idempotency-Key (one per opening) and throws the axios error back so it shows it.
  async function receive(body, idempotencyKey) {
    const res = await http.post('/api/stock/receive', body, { headers: { 'Idempotency-Key': idempotencyKey } })
    // A replay (BL14) answers an earlier identical send: nothing was added a second time.
    if (res.headers['idempotency-replayed'] === 'true') toast.info('Penerimaan ini sudah tercatat sebelumnya. Stok tidak bertambah dua kali.')
    else toast.success('Penerimaan stok berhasil dicatat.')
    setReceiving(false)
    setStockVersion((n) => n + 1)
  }

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
            {canWrite && !product.archivedAt && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setReceiving(true)}>
                Terima stok
              </button>
            )}
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
          <ProductStockSection productId={product.id} unit={product.unit} refreshKey={stockVersion} />
          <MovementHistorySection scope={{ productId: product.id }} refreshKey={stockVersion} title="Riwayat produk" />
          {receiving && <StockReceiveModal productId={product.id} onSubmit={receive} onClose={() => setReceiving(false)} />}
        </>
      )}
    </div>
  )
}
