import { useCallback, useEffect, useMemo, useState } from 'react'
import http, { getToken, onUnauthorized, setToken } from '../utils/http'
import { AuthContext } from './authContext'

const EMPTY_SESSION = { user: null, organization: null }

// Holds who is logged in. The token lives in localStorage (utils/http.js); this context holds the
// user that GET /api/me returns for that token, so every screen reads one source.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(EMPTY_SESSION)
  // True after a 401 on a logged-in request; P19 reads it. The token is already cleared by then.
  const [sessionExpired, setSessionExpired] = useState(false)
  // True while the stored token is being checked on app start, so routes do not flash the login page.
  const [loading, setLoading] = useState(() => Boolean(getToken()))
  // True when the stored token could not be checked because the server did not answer (network or 5xx).
  // The token is kept, so the login screen can say what happened and offer a retry.
  const [connectionFailed, setConnectionFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!getToken()) return undefined
    let cancelled = false // React StrictMode runs effects twice in development; ignore the first run
    http
      .get('/api/me')
      .then(({ data }) => {
        if (cancelled) return
        setSession({ user: data.user, organization: data.organization })
        setConnectionFailed(false)
      })
      .catch((error) => {
        if (cancelled) return
        // Only a 401 means the token is bad. A network error keeps the token so a retry can work.
        if (error.response?.status === 401) setToken(null)
        else setConnectionFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retrySession = useCallback(() => {
    setConnectionFailed(false)
    setLoading(true)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(
    () =>
      onUnauthorized(() => {
        setToken(null)
        setSession(EMPTY_SESSION)
        setSessionExpired(true)
      }),
    [],
  )

  const dismissSessionExpired = useCallback(() => setSessionExpired(false), [])

  // Returns the path the API wants after login ("/dashboard" or "/platform").
  const login = useCallback(async (email, password) => {
    const { data } = await http.post('/api/auth/login', { email, password })
    setToken(data.token)
    // The login response has no organization; /api/me gives the same shape as an app restart.
    const me = await http.get('/api/me')
    setSession({ user: me.data.user, organization: me.data.organization })
    setSessionExpired(false)
    setConnectionFailed(false)
    return data.redirectTo
  }, [])

  // Sign-up (S02): the API answers like login (a token and redirectTo), so the session starts the same way.
  const registerOrganization = useCallback(async (payload) => {
    const { data } = await http.post('/api/auth/register-organization', payload)
    setToken(data.token)
    const me = await http.get('/api/me')
    setSession({ user: me.data.user, organization: me.data.organization })
    setSessionExpired(false)
    setConnectionFailed(false)
    return data.redirectTo
  }, [])

  // Accepting an invitation (S03): same answer shape as login (token and redirectTo), so the same session start.
  const acceptInvite = useCallback(async (payload) => {
    const { data } = await http.post('/api/auth/accept-invite', payload)
    setToken(data.token)
    const me = await http.get('/api/me')
    setSession({ user: me.data.user, organization: me.data.organization })
    setSessionExpired(false)
    setConnectionFailed(false)
    return data.redirectTo
  }, [])

  // After S15 saves, the sidebar shows the new name without a reload: only the organization part changes.
  const updateOrganization = useCallback((changes) => {
    setSession((current) => ({ ...current, organization: current.organization ? { ...current.organization, ...changes } : current.organization }))
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

  const value = useMemo(
    () => ({ ...session, loading, connectionFailed, retrySession, sessionExpired, dismissSessionExpired, login, registerOrganization, acceptInvite, updateOrganization, logout }),
    [session, loading, connectionFailed, retrySession, sessionExpired, dismissSessionExpired, login, registerOrganization, acceptInvite, updateOrganization, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
