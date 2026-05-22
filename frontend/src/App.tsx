import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { Pending } from './pages/Pending'
import { Dashboard } from './pages/Dashboard'
import { TournamentView } from './pages/TournamentView'
import { TournamentSummary } from './pages/TournamentSummary'
import { AdminMembers } from './pages/admin/Members'
import { AdminTournaments } from './pages/admin/Tournaments'
import { AdminMatches } from './pages/admin/Matches'
import { AdminPredictions } from './pages/admin/Predictions'
import { AdminHighlights } from './pages/admin/Highlights'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Auth required, any status — for the approval waiting room */}
        <Route element={<ProtectedRoute />}>
          <Route path="/pending" element={<Pending />} />
        </Route>

        {/* Auth + active status required */}
        <Route element={<ProtectedRoute requireActive />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tournaments/:id" element={<TournamentView />} />
          <Route path="/tournaments/:id/summary" element={<TournamentSummary />} />

          {/* Auth + active + admin */}
          <Route element={<ProtectedRoute requireAdmin />}>
            <Route path="/admin/members" element={<AdminMembers />} />
            <Route path="/admin/tournaments" element={<AdminTournaments />} />
            <Route path="/admin/matches" element={<AdminMatches />} />
            <Route path="/admin/predictions" element={<AdminPredictions />} />
            <Route path="/admin/highlights" element={<AdminHighlights />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
