import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface Props {
  requireActive?: boolean
  requireAdmin?: boolean
}

export function ProtectedRoute({ requireActive = false, requireAdmin = false }: Props) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-charcoal flex items-center justify-center">
        <span className="text-xs text-gold uppercase tracking-[0.3em]">Loading…</span>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (!profile) return null

  if (requireActive) {
    if (profile.status === 'pending') return <Navigate to="/pending" replace />
    if (profile.status === 'suspended') return <Navigate to="/login" replace />
  }

  if (requireAdmin && !profile.is_admin) return <Navigate to="/" replace />

  return <Outlet />
}
