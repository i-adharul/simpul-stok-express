import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import BaseLayout from './layouts/BaseLayout'
import ProtectedRoute from './components/ProtectedRoute'
import SessionExpiredModal from './components/SessionExpiredModal'
import EmptyState from './components/EmptyState'
import ErrorState from './components/ErrorState'
import LoadingSkeleton from './components/LoadingSkeleton'
import Login from './views/Login'
import Profile from './views/Profile'
import StockSummary from './views/StockSummary'
import { toast } from './utils/toast'
import { formatDateTime, formatNumber } from './utils/format'

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
      <ErrorState onRetry={() => toast.info('Mencoba lagi...')} />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <SessionExpiredModal />
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<BaseLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="profile" element={<Profile />} />
            <Route path="stock" element={<StockSummary />} />
            <Route path="dashboard" element={<StatesPreview />} />
            <Route path="*" element={<Placeholder title="Halaman belum tersedia" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
