import { createContext, useContext } from 'react'

// Kept apart from AuthProvider so that file only exports a component (React fast refresh).
export const AuthContext = createContext(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
