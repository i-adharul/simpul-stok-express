import { useEffect, useState } from 'react'
import { fetchAll } from './useStockOptions'

// Active warehouses of the organization (the Owner sees all of them): { items, total } or null while
// loading. All pages (the API maximum is 100 per page). Used by S14 for
// "Semua gudang (N)" and by P07 for the checkboxes.
export function useActiveWarehouses() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchAll('/api/warehouses', {}, controller.signal)
      .then((items) => {
        setData({ items, total: items.length })
        setError(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [attempt])
  return { warehouses: data, error, retry: () => setAttempt((n) => n + 1) }
}
