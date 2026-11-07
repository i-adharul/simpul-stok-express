import { MOVEMENT_TYPES } from '../constants/stock'
import { formatDateTime, formatNumber } from '../utils/format'

const TYPE_BADGE = {
  RECEIVE: 'badge-warning',
  ADJUST: 'badge-neutral',
  TRANSFER_OUT: 'badge-primary',
  TRANSFER_IN: 'badge-primary',
  IMPORT: 'badge-ghost',
}

function MovementRow({ movement, warehouses, products, showProduct, showWarehouse, onOpen }) {
  const product = products.get(movement.productId)
  const delta = movement.quantityDelta
  return (
    <tr className="cursor-pointer hover:bg-base-200" onClick={() => onOpen(movement.id)}>
      <td className="whitespace-nowrap text-sm">{formatDateTime(movement.createdAt)}</td>
      <td>
        <span className={`badge badge-soft ${TYPE_BADGE[movement.type]}`}>{MOVEMENT_TYPES[movement.type]}</span>
      </td>
      {showProduct && (
        <td>
          <div className="font-medium">{product?.name ?? '—'}</div>
          <div className="text-xs text-base-content/60">{product?.sku}</div>
        </td>
      )}
      {showWarehouse && <td>{warehouses.get(movement.warehouseId)?.name ?? '—'}</td>}
      <td className={`text-right font-semibold ${delta < 0 ? 'text-error' : 'text-success'}`}>
        {delta > 0 && '+'}
        {formatNumber(delta)} {product?.unit}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(movement.id)
          }}
        >
          Detail
        </button>
      </td>
    </tr>
  )
}

// The history table of S06, S08 and S10. `warehouses` and `products` are Maps by id (from useStockOptions);
// a screen that is already about one warehouse or one product hides that column. A click opens P13.
export default function MovementTable({ items, warehouses, products, showProduct = true, showWarehouse = true, onOpen }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
      <table className="table">
        <thead>
          <tr>
            <th>Waktu (WIB)</th>
            <th>Tipe</th>
            {showProduct && <th>Produk</th>}
            {showWarehouse && <th>Gudang</th>}
            <th className="text-right">Perubahan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <MovementRow key={m.id} movement={m} warehouses={warehouses} products={products} showProduct={showProduct} showWarehouse={showWarehouse} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
