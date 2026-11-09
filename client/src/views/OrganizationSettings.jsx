import { useEffect, useState } from 'react'
import ErrorState from '../components/ErrorState'
import FormField from '../components/FormField'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { useAuth } from '../context/authContext'
import { GENERIC_ERROR, errorText, fieldErrorsFrom } from '../utils/apiError'
import http from '../utils/http'
import { toast } from '../utils/toast'

// Same limits as the API (docs/04: name 1 to 100, address at most 255).
function validate({ name, address }) {
  const errors = {}
  if (!name.trim()) errors.name = 'Nama organisasi wajib diisi.'
  else if (name.trim().length > 100) errors.name = 'Nama organisasi maksimal 100 karakter.'
  if (address.length > 255) errors.address = 'Alamat maksimal 255 karakter.'
  return errors
}

function ReadOnlyField({ label, value, note }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center justify-between rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content/70">
        <span>{value}</span>
        <span className="material-symbols-outlined text-[16px]" title="Terkunci secara sistem">lock</span>
      </div>
      {note && <p className="text-xs text-base-content/60">{note}</p>}
    </div>
  )
}

// S15. Owner only (the route guard decides who gets here). The slug and the time zone are read-only.
export default function OrganizationSettings() {
  const { updateOrganization } = useAuth()
  const [organization, setOrganization] = useState(null)
  const [values, setValues] = useState({ name: '', address: '' })
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    http
      .get('/api/organization')
      .then(({ data }) => {
        if (cancelled) return
        setOrganization(data.organization)
        setValues({ name: data.organization.name, address: data.organization.address ?? '' })
        setLoadError(null)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorText(error) ?? GENERIC_ERROR)
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined, general: undefined }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return
    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    try {
      const { data } = await http.patch('/api/organization', { name: values.name.trim(), address: values.address.trim() })
      setOrganization(data.organization)
      setValues({ name: data.organization.name, address: data.organization.address ?? '' })
      updateOrganization({ name: data.organization.name })
      toast.success('Pengaturan organisasi disimpan.')
    } catch (error) {
      const byField = fieldErrorsFrom(error)
      setErrors(Object.keys(byField).length > 0 ? byField : { general: errorText(error) ?? GENERIC_ERROR })
    } finally {
      setSaving(false)
    }
  }

  const unchanged = organization && values.name.trim() === organization.name && values.address.trim() === (organization.address ?? '')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pengaturan</h1>
        <p className="text-sm text-base-content/70">Kelola profil bisnis dan konfigurasi organisasi Anda.</p>
      </div>

      {loadError && <ErrorState message={loadError} onRetry={() => setAttempt((n) => n + 1)} />}
      {!organization && !loadError && <LoadingSkeleton rows={4} />}

      {organization && (
        <>
          <form className="space-y-5 rounded-xl border border-base-300 bg-base-100 p-6" onSubmit={handleSubmit} noValidate>
            <div className="border-b border-base-300 pb-3">
              <h2 className="font-bold">Profil organisasi</h2>
              <p className="text-xs text-base-content/60">Informasi umum bisnis Anda yang tertera pada laporan dan dokumen inventori.</p>
            </div>
            <FormField id="org-name" label="Nama organisasi" required maxLength={100} value={values.name} onChange={set('name')} error={errors.name} />
            <ReadOnlyField label="Slug organisasi" value={organization.slug} note="Slug dibuat saat pendaftaran dan tidak bisa diubah." />
            <FormField id="org-address" label="Alamat bisnis" multiline rows={3} maxLength={255} value={values.address} onChange={set('address')} error={errors.address} />
            {errors.general && (
              <p role="alert" className="text-sm font-medium text-error">
                {errors.general}
              </p>
            )}
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" disabled={saving || unchanged}>
                {saving ? <span className="loading loading-spinner loading-sm" /> : 'Simpan perubahan'}
              </button>
            </div>
          </form>

          <section className="space-y-4 rounded-xl border border-base-300 bg-base-100 p-6">
            <div className="border-b border-base-300 pb-3">
              <h2 className="font-bold">Zona waktu dan format</h2>
              <p className="text-xs text-base-content/60">Zona waktu dan format mengikuti standar Indonesia dan tidak dapat diubah.</p>
            </div>
            <ReadOnlyField label="Zona waktu" value="WIB (Waktu Indonesia Barat) — UTC+07:00" />
            <ReadOnlyField label="Format angka dan tanggal" value="Indonesia (1.234,50 • 24 Okt 2024)" />
          </section>
        </>
      )}
    </div>
  )
}
