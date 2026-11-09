import LoadingSkeleton from '../components/LoadingSkeleton'

// S19 placeholder. The real list (organizations with plan, status and usage) arrives with E11-03; until then
// this page only proves the routing and the layout of the Platform admin.
export default function PlatformOrganizations() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Organisasi</h1>
        <p className="text-sm text-base-content/70">Daftar organisasi akan tersedia di sini.</p>
      </div>
      <LoadingSkeleton rows={4} />
    </div>
  )
}
