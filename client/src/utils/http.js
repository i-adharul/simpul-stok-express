import axios from 'axios'
import { BASE_URL } from '../constants/baseUrl'

// The JWT is kept in localStorage (docs: BL01). Wrapped in try/catch because storage can be blocked.
export const TOKEN_KEY = 'access_token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage is unavailable: the user simply has to log in again.
  }
}

const http = axios.create({ baseURL: BASE_URL })

// Runs before every request, so a token saved after login is picked up without recreating the instance.
http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// AuthContext registers one function here. A module-level hook keeps this file free of React.
let unauthorizedHandler = null

export function onUnauthorized(handler) {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

// Same idea for the S23 pages: a function registered from inside the router (it needs useNavigate).
let errorPageHandler = null

export function onErrorPage(handler) {
  errorPageHandler = handler
  return () => {
    if (errorPageHandler === handler) errorPageHandler = null
  }
}

// Which S23 page answers a failed request? Only a GET (the screen cannot load): a failed write keeps
// the form open so the user does not lose what they typed. 403 counts only with code FORBIDDEN,
// because PLAN_LIMIT_REACHED and SUBSCRIPTION_READ_ONLY are also 403 and have their own message.
export function errorPageFor(error) {
  const status = error.response?.status
  if (error.config?.method !== 'get') return null
  if (status >= 500) return '/error'
  if (status === 403 && error.response.data?.code === 'FORBIDDEN') return '/forbidden'
  return null
}

// A 401 on a request that carried a token means the session is gone (expired, or the password was
// changed elsewhere): P19 opens. A 401 without a token (wrong login password) is a normal form error.
http.interceptors.response.use(
  (response) => response,
  (error) => {
    const sentToken = Boolean(error.config?.headers?.Authorization)
    if (error.response?.status === 401 && sentToken) unauthorizedHandler?.()
    const page = errorPageFor(error)
    if (page) errorPageHandler?.(page)
    return Promise.reject(error)
  },
)

export default http
