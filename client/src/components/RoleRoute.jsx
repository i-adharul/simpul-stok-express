import { Outlet } from 'react-router'
import { useAuth } from '../context/authContext'
import Forbidden from '../views/Forbidden'

// Layout route for screens that only some roles may open (for example S14 and S15 are Owner only).
// A role that may not gets the S23 403 page instead of the screen. The server still answers 403 on
// every endpoint of that screen; this only avoids showing a screen that cannot work.
export default function RoleRoute({ roles }) {
  const { user } = useAuth()
  return roles.includes(user.role) ? <Outlet /> : <Forbidden />
}
