import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import BaseLayout from './layouts/BaseLayout'
import EmptyState from './components/EmptyState'
import ErrorState from './components/ErrorState'
import LoadingSkeleton from './components/LoadingSkeleton'
import { formatDateTime, formatNumber } from './utils/format'

// Temporary user until E1-04 adds AuthContext (login and session).
const PLACEHOLDER_USER = { name: 'Pengguna Contoh', role: 'OWNER', organizationName: 'Organisasi Contoh' }

function Placeholder({ title }) {
  return <h1 className="text-xl font-bold">{title}</h1>
}

// Temporary preview of the three states; removed when the first real view lands.
function StatesPreview() {
  return (
    <div className="space-y-6">
      <Placeholder title="Dashboard" />
      <p>
        Contoh format: {formatDateTime('2026-11-05T17:00:00Z')} dan {formatNumber(1234567.5)}
      </p>
      <LoadingSkeleton rows={3} />
      <EmptyState message="Belum ada gudang." actionLabel="Tambah gudang" />
      <ErrorState onRetry={() => {}} />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<BaseLayout user={PLACEHOLDER_USER} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<StatesPreview />} />
          <Route path="*" element={<Placeholder title="Halaman belum tersedia" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
