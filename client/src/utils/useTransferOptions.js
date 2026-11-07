import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { GENERIC_ERROR, errorText } from './apiError'
import http from './http'
import { fetchAll } from './useStockOptions'

// The choices of S11. Source warehouses: GET /api/warehouses (an Owner's active ones, a Warehouse Admin's
// assigned ones). Destinations: GET /api/stock/transfers/destinations (every active warehouse, BL13).
// `reload` reads both again (after a refusal that says a warehouse is no longer usable).
export function useWarehouseChoices() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, sources: [], destinations: [], error: null })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchAll('/api/warehouses', {}, controller.signal),
      http.get('/api/stock/transfers/destinations', { signal: controller.signal }),
    ])
      .then(([sources, destinations]) =>
        setState({ key: attempt, sources: sources.filter((w) => !w.archivedAt), destinations: destinations.data.items, error: null }),
      )
      .catch((err) => {
        if (axios.isCancel(err)) return
        setState({ key: attempt, sources: [], destinations: [], error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, loading: state.key !== attempt, reload }
}

// The stock rows of one source warehouse as productId -> { product, quantity }. Only active products that
// hold stock can be transferred, so those are the only ones kept. Empty while no warehouse is chosen.
export function useSourceStock(warehouseId) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, stock: {}, error: null })
  const key = `${warehouseId}|${attempt}`

  useEffect(() => {
    if (!warehouseId) return undefined
    const controller = new AbortController()
    fetchAll('/api/stock', { warehouseId }, controller.signal)
      .then((rows) => {
        const stock = {}
        for (const row of rows) if (!row.product.archived && row.quantity > 0) stock[row.product.id] = { product: row.product, quantity: row.quantity }
        setState({ key, stock, error: null })
      })
      .catch((err) => {
        if (axios.isCancel(err)) return
        setState({ key, stock: {}, error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [warehouseId, key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  if (!warehouseId) return { stock: {}, loading: false, error: null, reload }
  return { stock: state.key === key ? state.stock : {}, loading: state.key !== key, error: state.key === key ? state.error : null, reload }
}
