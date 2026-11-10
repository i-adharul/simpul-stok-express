import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import BaseLayout from './layouts/BaseLayout'
import PlatformLayout from './layouts/PlatformLayout'
import LandingLayout from './layouts/LandingLayout'
import Landing from './views/Landing'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import PlatformOrganizations from './views/PlatformOrganizations'
import ProtectedRoute from './components/ProtectedRoute'
import RoleRoute from './components/RoleRoute'
import SessionExpiredModal from './components/SessionExpiredModal'
import Dashboard from './views/Dashboard'
import Login from './views/Login'
import Register from './views/Register'
import AcceptInvite from './views/AcceptInvite'
import ResetPassword from './views/ResetPassword'
import Profile from './views/Profile'
import OrganizationSettings from './views/OrganizationSettings'
import Members from './views/Members'
import StockSummary from './views/StockSummary'
import Movements from './views/Movements'
import Warehouses from './views/Warehouses'
import Products from './views/Products'
import WarehouseDetail from './views/WarehouseDetail'
import ProductDetail from './views/ProductDetail'
import TransferDetail from './views/TransferDetail'
import TransferNew from './views/TransferNew'
import NotFound from './views/NotFound'
import Forbidden from './views/Forbidden'
import ServerError from './views/ServerError'
import ErrorBoundary from './components/ErrorBoundary'
import ApiErrorRedirect from './components/ApiErrorRedirect'

function App() {
  return (
    <BrowserRouter>
      <SessionExpiredModal />
      <ApiErrorRedirect />
      <ErrorBoundary>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route element={<LandingLayout />}>
              <Route index element={<Landing />} />
            </Route>
          </Route>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="invite/:token" element={<AcceptInvite />} />
          <Route path="reset/:token" element={<ResetPassword />} />
          <Route path="platform" element={<PlatformLayout />}>
            <Route index element={<Navigate to="/platform/organizations" replace />} />
            <Route path="organizations" element={<PlatformOrganizations />} />
            <Route path="*" element={<Navigate to="/platform/organizations" replace />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<BaseLayout />}>
              <Route path="profile" element={<Profile />} />
              <Route element={<RoleRoute roles={['OWNER']} />}>
                <Route path="settings" element={<OrganizationSettings />} />
                <Route path="members" element={<Members />} />
              </Route>
              <Route path="stock" element={<StockSummary />} />
              <Route path="movements" element={<Movements />} />
              <Route path="warehouses" element={<Warehouses />} />
              <Route path="warehouses/:id" element={<WarehouseDetail />} />
              <Route path="products" element={<Products />} />
              <Route path="products/:id" element={<ProductDetail />} />
              <Route path="transfers/new" element={<TransferNew />} />
              <Route path="transfers/:id" element={<TransferDetail />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="not-found" element={<NotFound />} />
              <Route path="forbidden" element={<Forbidden />} />
              <Route path="error" element={<ServerError />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

export default App
