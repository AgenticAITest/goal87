import { Link, useNavigate, useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const ADMIN_LINKS = [
  { to: '/admin/tournaments', label: 'Tournaments' },
  { to: '/admin/matches',     label: 'Matches' },
  { to: '/admin/predictions', label: 'Predictions' },
  { to: '/admin/members',     label: 'Members' },
]

export function Navbar() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <nav className="border-b border-white/10 bg-charcoal/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
        <Link to="/" className="font-serif text-gold text-lg font-bold tracking-wide gold-glow shrink-0">
          Pildun
        </Link>

        {profile?.is_admin && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {ADMIN_LINKS.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`px-3 py-1 rounded-full text-xs uppercase tracking-widest whitespace-nowrap transition-colors ${
                  pathname === to ? 'bg-gold/10 text-gold' : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white uppercase tracking-widest transition-colors shrink-0 ml-auto"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </nav>
  )
}
