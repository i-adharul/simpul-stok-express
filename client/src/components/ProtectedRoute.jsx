import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../context/authContext'
import LoadingSkeleton from './LoadingSkeleton'

// Layout route that guards every private screen. The server still decides on every request; this
// only keeps a visitor without a session from seeing an empty shell.
export default function ProtectedRoute() {
  const { user, loading, sessionExpired } = useAuth()

  if (loading) return <LoadingSkeleton rows={3} />
  if (!user) {
    // After a 401 the user stays on the page and P19 explains it; its button goes to /login.
    return sessionExpired ? null : <Navigate to="/login" replace />
  }
  // A platform admin has no organization, so tenant screens are not theirs (S19 is their home).
  if (user.role === 'PLATFORM_ADMIN') return <Navigate to="/platform/organizations" replace />
  return <Outlet />
}
