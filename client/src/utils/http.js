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

export default http
