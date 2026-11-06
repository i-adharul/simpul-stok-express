import { useEffect, useState } from 'react'
import { GENERIC_ERROR, errorText } from './apiError'
import http from './http'

// The choices of the stock popups. GET /api/warehouses already returns only the warehouses the caller may
// use, and GET /api/products only active products, so nothing is filtered here. One page of 100 each
// (the API maximum): a longer catalog is a known limit of this first version.
export function useStockOptions() {
  const [state, setState] = useState({ warehouses: [], products: [], loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()
    const config = { params: { pageSize: 100 }, signal: controller.signal }
    Promise.all([http.get('/api/warehouses', config), http.get('/api/products', config)])
      .then(([w, p]) => setState({ warehouses: w.data.items, products: p.data.items, loading: false, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState((s) => ({ ...s, loading: false, error: errorText(err) ?? GENERIC_ERROR }))
      })
    return () => controller.abort()
  }, [])

  return state
}
