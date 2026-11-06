import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import http from './http'
import { GENERIC_ERROR, errorText } from './apiError'

// Loads one page of a list endpoint ({ items, total, page, pageSize }). `reload` refetches the same page
// (after a save); an aborted older request never overwrites a newer one.
export function usePagedList(url, extraParams = {}) {
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ key: null, data: null, error: null })
  const paramsKey = JSON.stringify(extraParams)
  const key = `${url}|${paramsKey}|${page}|${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(url, { params: { ...JSON.parse(paramsKey), page, pageSize: 20 }, signal: controller.signal })
      .then((res) => setState({ key, data: res.data, error: null }))
      .catch((err) => {
        if (axios.isCancel(err)) return
        setState({ key, data: null, error: errorText(err) ?? GENERIC_ERROR })
      })
    return () => controller.abort()
  }, [url, paramsKey, page, attempt, key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const resetPage = useCallback(() => setPage(1), [])
  return { ...state, loading: state.key !== key, page, setPage, reload, resetPage }
}
