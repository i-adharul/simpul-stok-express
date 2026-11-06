import { useEffect, useState } from 'react'
import ErrorState from './ErrorState'
import LoadingSkeleton from './LoadingSkeleton'
import { ROLE_LABELS } from '../constants/navigation'
import { GENERIC_ERROR, errorText } from '../utils/apiError'
import { formatNumber } from '../utils/format'
import http from '../utils/http'
import { toast } from '../utils/toast'

// P06. Opened from S06 (wired there in E3-08). Owner only on the server (`member.manage`).
// GET lists the candidates (active Warehouse Admins and Viewers) with `assigned`; PUT replaces the
// whole assignment with the ids that are ticked here, so an empty selection removes everyone.
export default function AssignUsersModal({ warehouse, onSaved, onClose }) {
  const [candidates, setCandidates] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    http
      .get(`/api/warehouses/${warehouse.id}/members`, { signal: controller.signal })
      .then(({ data }) => {
        setCandidates(data.candidates)
        setSelected(new Set(data.candidates.filter((c) => c.assigned).map((c) => c.id)))
        setLoadError(null)
      })
      .catch((err) => {
        if (!controller.signal.aborted) setLoadError(errorText(err) ?? GENERIC_ERROR)
      })
    return () => controller.abort()
  }, [warehouse.id, attempt])

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    if (submitting) return
    setSubmitting(true)
    setSaveError(null)
    try {
      await http.put(`/api/warehouses/${warehouse.id}/members`, { userIds: [...selected] })
      toast.success('Penugasan pengguna berhasil disimpan.')
      onSaved?.()
    } catch (err) {
      setSaveError(errorText(err) ?? GENERIC_ERROR)
      setSubmitting(false)
    }
  }

  const term = search.trim().toLowerCase()
  const shown = (candidates ?? []).filter((c) => !term || c.name.toLowerCase().includes(term) || c.email.toLowerCase().includes(term))

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="assign-title">
      <div className="modal-box max-w-lg space-y-4">
        <div>
          <h2 id="assign-title" className="text-lg font-semibold">
            Tugaskan pengguna
          </h2>
          <p className="text-sm text-base-content/70">Pilih pengguna yang memiliki akses operasional di {warehouse.name}.</p>
        </div>
        {loadError && <ErrorState message={loadError} onRetry={() => setAttempt((n) => n + 1)} />}
        {!loadError && !candidates && <LoadingSkeleton rows={3} />}
        {candidates && (
          <>
            <input type="search" className="input input-sm w-full" placeholder="Cari nama atau email..." aria-label="Cari pengguna" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
            {candidates.length === 0 ? (
              <p className="rounded-box border border-dashed border-base-300 p-6 text-center text-sm text-base-content/70">
                Belum ada Admin Gudang atau Viewer aktif. Undang anggota lebih dulu.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-base-300 overflow-y-auto rounded-box border border-base-300">
                {shown.map((c) => (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-3 p-3">
                      <input type="checkbox" className="checkbox checkbox-sm" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-base-content/60">{c.email}</span>
                      </span>
                      <span className="badge badge-soft badge-sm">{ROLE_LABELS[c.role] ?? c.role}</span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="p-4 text-center text-sm text-base-content/60">Tidak ada pengguna yang cocok.</li>}
              </ul>
            )}
          </>
        )}
        {saveError && (
          <p role="alert" className="text-sm font-medium text-error">
            {saveError}
          </p>
        )}
        <div className="modal-action items-center justify-between">
          <span className="text-sm text-base-content/70">{formatNumber(selected.size)} dipilih</span>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose} disabled={submitting}>
              Batal
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={submitting || !candidates}>
              {submitting ? <span className="loading loading-spinner loading-sm" /> : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
