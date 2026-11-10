import { useEffect, useState } from 'react'
import http from './http'

// Does the server allow the demo (DEMO_MODE, BL31)? There is no endpoint for that on purpose, so the
// answer cannot leak the demo accounts. Instead the app sends POST /api/auth/demo-login with an empty
// body, which signs nobody in: with DEMO_MODE on the body check answers 400 VALIDATION_ERROR, with it
// off the door answers 404 before the body is read. Anything else (5xx, no network) counts as "not
// available". Returns null while the answer is pending, then true or false.
export function useDemoAvailable() {
  const [available, setAvailable] = useState(null)

  useEffect(() => {
    let cancelled = false // React StrictMode runs effects twice in development
    http
      .post('/api/auth/demo-login', {})
      .then(() => false) // an empty body is never accepted; a 2xx would be unexpected, so hide the panel
      .catch((error) => error.response?.status === 400)
      .then((result) => {
        if (!cancelled) setAvailable(result)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
