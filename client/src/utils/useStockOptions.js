import { useEffect, useState } from 'react'
import { GENERIC_ERROR, errorText } from './apiError'
import http from './http'

const PAGE_SIZE = 100 // the API maximum

// Reads every page of a list endpoint, so a plan with more than 100 rows still gets all its choices.
async function fetchAll(url, params, signal) {
  const items = []
  for (let page = 1; ; page += 1) {
    const { data } = await http.get(url, { params: { ...params, page, pageSize: PAGE_SIZE }, signal })
    items.push(...data.items)
    if (items.length >= data.total || data.items.length === 0) return items
  }
}

// The choices of the stock popups and filters. GET /api/warehouses already returns only the warehouses the
// caller may use. Products come with the archived ones too (`includeArchived` is honoured for the Owner and
// ignored for the others): an archived product can still be adjusted (BL12) and still appears in the history,
// but takes no receipt (BL11), so the popups decide what to offer by `archivedAt`.
export function useStockOptions() {
  const [state, setState] = useState({ warehouses: [], products: [], loading: true, error: null })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchAll('/api/warehouses', {}, controller.signal),
      fetchAll('/api/products', { includeArchived: true }, controller.signal),
    ])
      .then(([warehouses, products]) => setState({ warehouses, products, loading: false, error: null }))
      .catch((err) => {
        if (controller.signal.aborted) return
        setState((s) => ({ ...s, loading: false, error: errorText(err) ?? GENERIC_ERROR }))
      })
    return () => controller.abort()
  }, [])

  return state
}
