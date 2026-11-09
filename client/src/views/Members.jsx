import { ROLE_LABELS } from '../constants/navigation'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import Pagination from '../components/Pagination'
import { formatDateTime, timeRemaining } from '../utils/format'
import { useActiveWarehouses } from '../utils/useActiveWarehouses'
import { usePagedList } from '../utils/usePagedList'

// "Semua gudang (N)" when every active warehouse is assigned (an Owner always is), else the codes.
function accessText(member, activeCount) {
  const assigned = member.warehouses.length
  if (member.allWarehouses || (activeCount > 0 && assigned === activeCount)) return `Semua gudang (${activeCount})`
  if (assigned === 0) return 'Belum ditugaskan'
  return member.warehouses.map((w) => w.code).join(', ')
}

function ListState({ list, emptyMessage, children }) {
  const { data, error, loading, reload } = list
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return loading ? <LoadingSkeleton rows={4} /> : null
  if (data.total === 0) return <EmptyState message={emptyMessage} />
  return children
}

function MembersTable({ list, activeCount }) {
  const { data, loading, page, setPage } = list
  return (
    <div className={`rounded-xl border border-base-300 bg-base-100 ${loading ? 'opacity-60' : ''}`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Pengguna</th>
              <th>Peran</th>
              <th>Akses gudang</th>
              <th>Terakhir masuk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((m) => (
              <tr key={m.id} className={m.isActive ? '' : 'opacity-60'}>
                <td>
                  <span className="block font-medium">{m.name}</span>
                  <span className="block text-xs text-base-content/60">{m.email}</span>
                </td>
                <td>
                  <span className="badge badge-soft badge-sm">{ROLE_LABELS[m.role] ?? m.role}</span>
                </td>
                <td className="text-base-content/70">{accessText(m, activeCount)}</td>
                <td className="text-base-content/70">{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : 'Belum pernah'}</td>
                <td>
                  <span className={`badge badge-soft ${m.isActive ? 'badge-success' : 'badge-ghost'}`}>{m.isActive ? 'Aktif' : 'Nonaktif'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} page={page} pageSize={data.pageSize} unit="anggota" onPage={setPage} />
    </div>
  )
}

function InvitationsTable({ list }) {
  const { data, loading, page, setPage } = list
  return (
    <div className={`rounded-xl border border-base-300 bg-base-100 ${loading ? 'opacity-60' : ''}`}>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Peran</th>
              <th>Kedaluwarsa dalam</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.email}</td>
                <td>
                  <span className="badge badge-soft badge-sm">{ROLE_LABELS[i.role] ?? i.role}</span>
                </td>
                <td className="text-base-content/70">{timeRemaining(i.expiresAt)}</td>
                <td>
                  <span className={`badge badge-soft ${i.status === 'EXPIRED' ? 'badge-error' : 'badge-warning'}`}>{i.status === 'EXPIRED' ? 'Kedaluwarsa' : 'Menunggu'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={data.total} page={page} pageSize={data.pageSize} unit="undangan" onPage={setPage} />
    </div>
  )
}

// S14. Owner only (the route guard and the API both decide). Members and pending invitations are two
// separate lists with their own paging; the invite popup and cancel action follow in the next steps.
export default function Members() {
  const members = usePagedList('/api/members')
  const invitations = usePagedList('/api/invitations')
  const { warehouses } = useActiveWarehouses()
  const activeCount = warehouses?.total ?? 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Anggota</h1>
        <p className="text-sm text-base-content/70">Kelola izin hak akses dan penugasan lokasi gudang untuk operasional staf.</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-bold">Anggota{members.data ? ` (${members.data.total})` : ''}</h2>
        <ListState list={members} emptyMessage="Belum ada anggota.">
          <MembersTable list={members} activeCount={activeCount} />
        </ListState>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">Undangan tertunda{invitations.data ? ` (${invitations.data.total})` : ''}</h2>
        <ListState list={invitations} emptyMessage="Tidak ada undangan tertunda.">
          <InvitationsTable list={invitations} />
        </ListState>
      </section>
    </div>
  )
}
