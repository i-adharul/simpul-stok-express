import { useCallback, useEffect, useMemo, useState } from 'react'
import http, { getToken, setToken } from '../utils/http'
import { AuthContext } from './authContext'

const EMPTY_SESSION = { user: null, organization: null }

// Holds who is logged in. The token lives in localStorage (utils/http.js); this context holds the
// user that GET /api/me returns for that token, so every screen reads one source.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(EMPTY_SESSION)
  // True while the stored token is being checked on app start, so routes do not flash the login page.
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) return undefined
    let cancelled = false // React StrictMode runs effects twice in development; ignore the first run
    http
      .get('/api/me')
      .then(({ data }) => {
        if (!cancelled) setSession({ user: data.user, organization: data.organization })
      })
      .catch((error) => {
        // Only a 401 means the token is bad. A network error keeps the token so a reload can retry.
        if (!cancelled && error.response?.status === 401) setToken(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Returns the path the API wants after login ("/dashboard" or "/platform").
  const login = useCallback(async (email, password) => {
    const { data } = await http.post('/api/auth/login', { email, password })
    setToken(data.token)
    // The login response has no organization; /api/me gives the same shape as an app restart.
    const me = await http.get('/api/me')
    setSession({ user: me.data.user, organization: me.data.organization })
    return data.redirectTo
  }, [])

  const logout = useCallback(async () => {
    try {
      await http.post('/api/auth/logout') // the server keeps no session; this call is only a courtesy
    } catch {
      // Logging out must work even when the server is unreachable.
    }
    setToken(null)
    setSession(EMPTY_SESSION)
  }, [])

  const value = useMemo(() => ({ ...session, loading, login, logout }), [session, loading, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
