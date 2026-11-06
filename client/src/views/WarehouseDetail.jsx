import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { ROLE_LABELS } from '../constants/navigation'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'
import NotFound from './NotFound'

// S06. GET /api/warehouses/:id returns the warehouse plus `assignedUsers` (active users, no emails).
// A missing, foreign or (for non-Owners) archived warehouse is a 404; an unassigned Warehouse Admin or
// Viewer gets 403, which the http interceptor already turns into the forbidden page.
export default function WarehouseDetail() {
  const { id } = useParams()
  const [state, setState] = useState({ id: null, warehouse: null, error: null, notFound: false })
  const [attempt, setAttempt] = useState(0)
  const key = `${id}|${attempt}`
  const [loadedKey, setLoadedKey] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/warehouses/${id}`, { signal: controller.signal })
      .then(({ data }) => {
        setState({ warehouse: data, error: null, notFound: false })
        setLoadedKey(key)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setState({ warehouse: null, error: errorText(err) ?? GENERIC_ERROR, notFound: err.response?.status === 404 })
        setLoadedKey(key)
      })
    return () => controller.abort()
  }, [id, attempt, key])

  const { warehouse, error, notFound } = state
  const loading = loadedKey !== key

  if (!loading && notFound) return <NotFound />
  return (
    <div className="space-y-6">
      <nav className="text-sm text-base-content/60">
        <Link className="link link-hover" to="/warehouses">
          Gudang
        </Link>
        {warehouse && <span> / {warehouse.name}</span>}
      </nav>
      {loading && !warehouse && <LoadingSkeleton rows={4} />}
      {!loading && error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {warehouse && (
        <>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{warehouse.name}</h1>
              <span className="badge badge-ghost font-mono">{warehouse.code}</span>
              <span className={`badge badge-soft ${warehouse.archivedAt ? 'badge-ghost' : 'badge-success'}`}>
                {warehouse.archivedAt ? 'Diarsipkan' : 'Aktif'}
              </span>
            </div>
            <p className="mt-1 text-sm text-base-content/70">{warehouse.address || 'Alamat belum diisi.'}</p>
          </div>
          <AssignedUsers users={warehouse.assignedUsers} />
        </>
      )}
    </div>
  )
}

// Who is responsible for this warehouse (BL10). The list is empty when nobody is assigned.
function AssignedUsers({ users }) {
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4">
      <h2 className="font-semibold">Penanggung jawab</h2>
      {users.length === 0 ? (
        <p className="mt-2 text-sm text-base-content/70">Belum ada pengguna yang ditugaskan.</p>
      ) : (
        <ul className="mt-2 divide-y divide-base-300">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2">
              <span className="font-medium">{u.name}</span>
              <span className="badge badge-soft badge-sm">{ROLE_LABELS[u.role] ?? u.role}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
