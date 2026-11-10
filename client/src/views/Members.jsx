import { useState } from 'react'
import { ROLE_LABELS } from '../constants/navigation'
import ChangeMemberAccessModal from '../components/ChangeMemberAccessModal'
import DeactivateMemberModal from '../components/DeactivateMemberModal'
import EmptyState from '../components/EmptyState'
import ErrorState from '../components/ErrorState'
import LoadingSkeleton from '../components/LoadingSkeleton'
import InvitationLinkModal from '../components/InvitationLinkModal'
import InviteMemberModal from '../components/InviteMemberModal'
import Pagination from '../components/Pagination'
import { formatDateTime, formatNumber, timeRemaining } from '../utils/format'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import http from '../utils/http'
import { toast } from '../utils/toast'
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

// Kebab menu of a row. The Owner row and an inactive member have no actions.
function RowActions({ member, onEdit, onResetLink, onDeactivate }) {
  if (member.role === 'OWNER' || !member.isActive) return null
  const pick = (action) => () => {
    document.activeElement?.blur()
    action(member)
  }
  return (
    <div className="dropdown dropdown-end">
      <button type="button" tabIndex={0} className="btn btn-ghost btn-xs btn-square" aria-label={`Aksi untuk ${member.name}`}>
        <span className="material-symbols-outlined text-[18px]">more_vert</span>
      </button>
      <ul tabIndex={0} className="menu dropdown-content z-10 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow">
        <li>
          <button type="button" onClick={pick(onEdit)}>Ubah akses</button>
        </li>
        {/* BL31: a shared demo account gets no reset link and cannot be deactivated. */}
        {!member.isDemo && (
          <>
            <li>
              <button type="button" onClick={pick(onResetLink)}>Buat tautan reset</button>
            </li>
            <li>
              <button type="button" className="text-error" onClick={pick(onDeactivate)}>Nonaktifkan</button>
            </li>
          </>
        )}
      </ul>
    </div>
  )
}

function MembersTable({ list, activeCount, onEdit, onResetLink, onDeactivate }) {
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
              <th />
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
                <td className="text-right">
                  <RowActions member={m} onEdit={onEdit} onResetLink={onResetLink} onDeactivate={onDeactivate} />
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

function InvitationsTable({ list, onCancel, cancellingId }) {
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
              <th />
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
                <td className="text-right">
                  <button type="button" className="btn btn-ghost btn-xs text-error" disabled={cancellingId === i.id} onClick={() => onCancel(i)}>
                    Batalkan
                  </button>
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
  const { warehouses, error: warehousesError, retry: retryWarehouses } = useActiveWarehouses()
  const activeCount = warehouses?.total ?? 0
  const [inviting, setInviting] = useState(false)
  // The 201 answer ({ invitation, token }) while P08 is open; dropped on close so the token is gone.
  const [created, setCreated] = useState(null)
  // { token, email } while P08 shows a reset link; dropped on close so the token is gone.
  const [resetLink, setResetLink] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [editing, setEditing] = useState(null) // member row for P09
  const [deactivating, setDeactivating] = useState(null) // member row for P10

  function handleMemberChanged(message) {
    setEditing(null)
    setDeactivating(null)
    toast.success(message)
    members.reload()
  }

  function handleCreated(answer) {
    setInviting(false)
    setCreated(answer)
    invitations.reload()
  }

  // POST answers 201 { token, expiresAt } once; the new link replaces any older one. Errors show as a toast
  // (409: the member is no longer active, 404: gone), then the list reloads so the row matches the server.
  async function createResetLink(member) {
    try {
      const { data } = await http.post(`/api/members/${member.id}/reset-link`, {})
      setResetLink({ token: data.token, email: member.email })
    } catch (error) {
      toast.error(errorText(error) ?? GENERIC_ERROR)
      if (error.response?.status === 404 || error.response?.status === 409) members.reload()
    }
  }

  // DELETE removes the row, so the link stops working. 404 means it is already gone: reload either way.
  async function cancelInvitation(invitation) {
    setCancellingId(invitation.id)
    try {
      await http.delete(`/api/invitations/${invitation.id}`)
      toast.success('Undangan dibatalkan.')
    } catch (error) {
      if (error.response?.status !== 404) toast.error(errorText(error) ?? GENERIC_ERROR)
    } finally {
      setCancellingId(null)
      invitations.reload()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Anggota</h1>
          <p className="text-sm text-base-content/70">Kelola izin hak akses dan penugasan lokasi gudang untuk operasional staf.</p>
          {members.data?.usage && (
            <p className="mt-1 text-sm font-semibold">
              {formatNumber(members.data.usage.used)} dari {formatNumber(members.data.usage.limit)} anggota
            </p>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setInviting(true)} disabled={!warehouses}>
          Undang anggota
        </button>
      </div>

      {warehousesError && <ErrorState message="Daftar gudang tidak dapat dimuat." onRetry={retryWarehouses} />}

      <section className="space-y-3">
        <h2 className="font-bold">Anggota{members.data ? ` (${members.data.total})` : ''}</h2>
        <ListState list={members} emptyMessage="Belum ada anggota.">
          <MembersTable list={members} activeCount={activeCount} onEdit={setEditing} onResetLink={createResetLink} onDeactivate={setDeactivating} />
        </ListState>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">Undangan tertunda{invitations.data ? ` (${invitations.data.total})` : ''}</h2>
        <ListState list={invitations} emptyMessage="Tidak ada undangan tertunda.">
          <InvitationsTable list={invitations} onCancel={cancelInvitation} cancellingId={cancellingId} />
        </ListState>
      </section>
      {editing && <ChangeMemberAccessModal member={editing} warehouses={warehouses?.items ?? []} onSaved={() => handleMemberChanged('Akses anggota diperbarui.')} onClose={() => setEditing(null)} />}
      {deactivating && <DeactivateMemberModal member={deactivating} onDone={() => handleMemberChanged('Anggota dinonaktifkan.')} onClose={() => setDeactivating(null)} />}
      {created && <InvitationLinkModal path={`/invite/${created.token}`} email={created.invitation.email} role={created.invitation.role} onClose={() => setCreated(null)} />}
      {resetLink && <InvitationLinkModal kind="reset" path={`/reset/${resetLink.token}`} email={resetLink.email} onClose={() => setResetLink(null)} />}
      {inviting && <InviteMemberModal warehouses={warehouses.items} onCreated={handleCreated} onClose={() => setInviting(false)} />}
    </div>
  )
}
