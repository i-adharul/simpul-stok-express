import { useState } from 'react'
import { Link } from 'react-router'
import ErrorState from '../components/ErrorState'
import FormField from '../components/FormField'
import SelectField from '../components/SelectField'
import { formatNumber } from '../utils/format'
import { MAX_ITEMS, MAX_NOTE, hasErrors, newRow, validateTransfer } from '../utils/transferForm'
import { useSourceStock, useWarehouseChoices } from '../utils/useTransferOptions'

function ItemRow({ row, stock, takenIds, errors, onChange, onRemove, disabled }) {
  const entry = stock[row.productId]
  const choices = Object.values(stock).filter((s) => s.product.id === row.productId || !takenIds.has(s.product.id))
  return (
    <div className={`space-y-2 rounded-xl border p-3 ${errors ? 'border-error' : 'border-base-300'}`}>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-start">
        <SelectField
          id={`item-product-${row.rowId}`}
          label="Produk"
          value={row.productId}
          onChange={(e) => onChange({ productId: e.target.value })}
          error={errors?.productId}
          disabled={disabled}
        >
          <option value="">Pilih produk</option>
          {choices.map(({ product, quantity }) => (
            <option key={product.id} value={product.id}>
              {product.sku} - {product.name} ({formatNumber(quantity)} {product.unit})
            </option>
          ))}
        </SelectField>
        <FormField
          id={`item-quantity-${row.rowId}`}
          label={entry ? `Jumlah (${entry.product.unit})` : 'Jumlah'}
          required
          inputMode="numeric"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          error={errors?.quantity}
          disabled={disabled}
        />
        <button type="button" className="btn btn-ghost btn-sm text-error sm:mt-7" aria-label="Hapus item" onClick={onRemove} disabled={disabled}>
          Hapus
        </button>
      </div>
      {entry && (
        <span className="badge badge-soft badge-success">
          {formatNumber(entry.quantity)} {entry.product.unit} tersedia
        </span>
      )}
    </div>
  )
}

function Summary({ from, to, rows, stock, onReview, disabled }) {
  const filled = rows.filter((r) => r.productId)
  const totalUnits = filled.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
  return (
    <aside className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4 lg:sticky lg:top-4">
      <h2 className="font-semibold">Ringkasan mutasi</h2>
      <div className="space-y-1 rounded-lg bg-base-200 p-3 text-sm">
        <div>
          <span className="badge badge-ghost badge-sm mr-2">Asal</span>
          {from ? from.name : '—'}
        </div>
        <div>
          <span className="badge badge-primary badge-soft badge-sm mr-2">Tujuan</span>
          {to ? to.name : '—'}
        </div>
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-base-content/70">Jumlah jenis item</dt>
          <dd>{formatNumber(filled.length)} produk</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-base-content/70">Total unit dikirim</dt>
          <dd className="font-bold">{formatNumber(totalUnits)} unit</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-base-content/70">Waktu proses</dt>
          <dd className="badge badge-soft badge-success">Instan (langsung tercatat)</dd>
        </div>
      </dl>
      <button type="button" className="btn btn-primary w-full" onClick={onReview} disabled={disabled}>
        Tinjau dan kirim
      </button>
      <Link to="/movements" className="btn w-full">
        Batal
      </Link>
      <p className="text-center text-xs text-base-content/60">Mutasi langsung selesai dan tidak dapat dibatalkan.</p>
      {Object.keys(stock).length === 0 && from && <p className="text-xs text-warning">Gudang asal belum punya stok yang bisa dimutasi.</p>}
    </aside>
  )
}

// S11. The form state is local (a transfer is one request, nothing to share between screens). The source
// choices are the caller's warehouses, the destination choices are every active warehouse (BL13), and the
// products on offer are the ones that hold stock in the source, with the available quantity beside them.
export default function TransferNew() {
  const choices = useWarehouseChoices()
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', note: '', rows: [newRow()] })
  const [errors, setErrors] = useState({ rows: {} })
  const source = useSourceStock(form.fromWarehouseId)

  const from = choices.sources.find((w) => w.id === form.fromWarehouseId)
  const to = choices.destinations.find((w) => w.id === form.toWarehouseId)
  const takenIds = new Set(form.rows.map((r) => r.productId).filter(Boolean))

  const setField = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }))
  // A different source holds different stock, so the chosen products no longer apply.
  const setSource = (event) => {
    setForm((f) => ({ ...f, fromWarehouseId: event.target.value, rows: [newRow()] }))
    setErrors({ rows: {} })
  }
  const changeRow = (rowId, patch) => setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)) }))
  const removeRow = (rowId) => setForm((f) => ({ ...f, rows: f.rows.filter((r) => r.rowId !== rowId) }))
  const addRow = () => setForm((f) => ({ ...f, rows: [...f.rows, newRow()] }))

  function review() {
    const found = validateTransfer(form, source.stock)
    setErrors(found)
    return !hasErrors(found)
  }

  const blocked = choices.loading || Boolean(choices.error)
  return (
    <div className="space-y-6">
      <nav className="text-sm text-base-content/60">Inventori / Buat mutasi</nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Buat mutasi stok</h1>
          <p className="text-sm text-base-content/70">Pindahkan stok antar gudang secara instan.</p>
        </div>
        <Link to="/movements" className="btn btn-sm">
          Kembali ke riwayat
        </Link>
      </div>
      {choices.error && <ErrorState message={choices.error} onRetry={choices.reload} />}
      {source.error && <ErrorState message={source.error} onRetry={source.reload} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-4">
            <h2 className="font-semibold">Informasi gudang dan catatan</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField id="transfer-from" label="Gudang asal" value={form.fromWarehouseId} onChange={setSource} error={errors.fromWarehouseId} disabled={blocked}>
                <option value="">{choices.loading ? 'Memuat...' : 'Pilih gudang asal'}</option>
                {choices.sources.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} - {w.name}
                  </option>
                ))}
              </SelectField>
              <SelectField id="transfer-to" label="Gudang tujuan" value={form.toWarehouseId} onChange={setField('toWarehouseId')} error={errors.toWarehouseId} disabled={blocked}>
                <option value="">{choices.loading ? 'Memuat...' : 'Pilih gudang tujuan'}</option>
                {choices.destinations
                  .filter((w) => w.id !== form.fromWarehouseId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} - {w.name}
                    </option>
                  ))}
              </SelectField>
            </div>
            <FormField id="transfer-note" label="Catatan mutasi (opsional)" multiline rows={2} maxLength={MAX_NOTE} value={form.note} onChange={setField('note')} error={errors.note} />
          </section>
          <section className="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Daftar item</h2>
                <p className="text-sm text-base-content/70">Pilih produk dari gudang asal.</p>
              </div>
              <span className="badge badge-ghost">{formatNumber(form.rows.length)} baris</span>
            </div>
            {!form.fromWarehouseId && <p className="text-sm text-base-content/60">Pilih gudang asal dulu untuk melihat produk yang tersedia.</p>}
            {form.fromWarehouseId &&
              form.rows.map((row) => (
                <ItemRow
                  key={row.rowId}
                  row={row}
                  stock={source.stock}
                  takenIds={takenIds}
                  errors={errors.rows[row.rowId]}
                  onChange={(patch) => changeRow(row.rowId, patch)}
                  onRemove={() => removeRow(row.rowId)}
                  disabled={source.loading}
                />
              ))}
            {errors.items && (
              <p role="alert" className="text-sm font-medium text-error">
                {errors.items}
              </p>
            )}
            <button type="button" className="btn btn-outline btn-block border-dashed" onClick={addRow} disabled={!form.fromWarehouseId || form.rows.length >= MAX_ITEMS}>
              + Tambah item
            </button>
          </section>
        </div>
        <Summary from={from} to={to} rows={form.rows} stock={source.stock} onReview={review} disabled={blocked || source.loading} />
      </div>
    </div>
  )
}
