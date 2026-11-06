// Pure helpers for S09. The API returns one row per (warehouse, product) pair; the screen shows
// one row per product with one cell per warehouse, so the pairs are grouped here.

export const STATUS_LABELS = { OUT: 'Habis', LOW: 'Menipis', OK: 'Cukup' }

const SEVERITY = { OUT: 0, LOW: 1, OK: 2 }

// Groups the API items by product, keeping the API order (product name, warehouse code).
// `cells` maps warehouseId -> { quantity, status }; a warehouse that is missing has no stock row.
export function groupByProduct(items) {
  const groups = new Map()
  for (const item of items) {
    let group = groups.get(item.product.id)
    if (!group) {
      group = { product: item.product, cells: {}, total: 0, worst: 'OK', badWarehouses: 0 }
      groups.set(item.product.id, group)
    }
    group.cells[item.warehouse.id] = { quantity: item.quantity, status: item.status }
    group.total += item.quantity
    if (item.status !== 'OK') group.badWarehouses += 1
    if (SEVERITY[item.status] < SEVERITY[group.worst]) group.worst = item.status
  }
  return [...groups.values()]
}

// Pages are cut by pair, not by product, so the first and last product of a page may continue on
// the neighbouring page. A missing cell there is unknown, not "no stock row".
export function cutGroups(groups, page, totalPages) {
  return {
    firstCut: page > 1 && groups.length > 0 ? groups[0].product.id : null,
    lastCut: page < totalPages && groups.length > 0 ? groups[groups.length - 1].product.id : null,
  }
}
