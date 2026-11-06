import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { onErrorPage } from '../utils/http'

// Renders nothing. It only connects the axios interceptor to the router: when a screen's GET fails
// with 403 or 500, the user lands on the matching S23 page. `replace` keeps "Kembali" from
// returning to the page that just failed. The failed path goes along as navigation state ({ from })
// so the 500 page can send the user back there to try again.
export default function ApiErrorRedirect() {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  useEffect(
    () =>
      onErrorPage((path) => {
        // A GET that fails while an error page is already open must not overwrite the real origin.
        if (pathname === path) return
        navigate(path, { replace: true, state: { from: pathname + search } })
      }),
    [navigate, pathname, search],
  )
  return null
}
