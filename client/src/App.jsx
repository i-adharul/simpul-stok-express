import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import BaseLayout from './layouts/BaseLayout'

// Temporary user until E1-04 adds AuthContext (login and session).
const PLACEHOLDER_USER = { name: 'Pengguna Contoh', role: 'OWNER', organizationName: 'Organisasi Contoh' }

function Placeholder({ title }) {
  return <h1 className="text-xl font-bold">{title}</h1>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<BaseLayout user={PLACEHOLDER_USER} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Placeholder title="Dashboard" />} />
          <Route path="*" element={<Placeholder title="Halaman belum tersedia" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
