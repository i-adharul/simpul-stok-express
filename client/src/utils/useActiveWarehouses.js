import { useEffect, useState } from 'react'
import http from './http'

// Active warehouses of the organization (the Owner sees all of them): { items, total } or null while
// loading. One page of 100 (the API maximum); the Starter plan allows far fewer. Used by S14 for
// "Semua gudang (N)" and by P07 for the checkboxes.
export function useActiveWarehouses() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    http
      .get('/api/warehouses', { params: { pageSize: 100 }, signal: controller.signal })
      .then(({ data: body }) => {
        setData({ items: body.items, total: body.total })
        setError(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
    return () => controller.abort()
  }, [attempt])
  return { warehouses: data, error, retry: () => setAttempt((n) => n + 1) }
}
