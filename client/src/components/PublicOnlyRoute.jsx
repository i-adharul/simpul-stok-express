import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/authContext'
import LoadingSkeleton from './LoadingSkeleton'

// Layout route for "/": a visitor sees the landing page, a logged-in user is sent to the app
// (a platform admin to S19, everyone else to S04). Only the screen is decided here; the API still
// checks every request.
export default function PublicOnlyRoute() {
  const { user, loading } = useAuth()

  if (loading) return <LoadingSkeleton rows={3} />
  if (user) return <Navigate to={user.role === 'PLATFORM_ADMIN' ? '/platform/organizations' : '/dashboard'} replace />
  return <Outlet />
}
