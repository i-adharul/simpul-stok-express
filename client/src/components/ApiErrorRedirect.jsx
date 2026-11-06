import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { onErrorPage } from '../utils/http'

// Renders nothing. It only connects the axios interceptor to the router: when a screen's GET fails
// with 403 or 500, the user lands on the matching S23 page. `replace` keeps "Kembali" from
// returning to the page that just failed.
export default function ApiErrorRedirect() {
  const navigate = useNavigate()
  useEffect(() => onErrorPage((path) => navigate(path, { replace: true })), [navigate])
  return null
}
