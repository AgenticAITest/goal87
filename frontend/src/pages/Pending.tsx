import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export function Pending() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Redirect immediately if already approved
  useEffect(() => {
    if (profile?.status === 'active') navigate('/', { replace: true })
  }, [profile, navigate])

  // Realtime: redirect the moment admin approves
  useEffect(() => {
    if (!profile) return

    const channel = supabase
      .channel(`profile:${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profile.id}` },
        (payload) => {
          if ((payload.new as { status: string }).status === 'active') {
            navigate('/', { replace: true })
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile, navigate])

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-charcoal flex items-center justify-center px-6">
      <div className="glass rounded-2xl p-10 w-full max-w-sm text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-yellow-400/10 flex items-center justify-center">
            <Clock className="text-yellow-400" size={26} />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="font-serif text-2xl font-bold text-white">Waiting for approval</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Hi {profile?.display_name || 'there'} — your account is pending admin approval.
            You'll be redirected automatically once you're in.
          </p>
        </div>

        <button
          onClick={signOut}
          className="text-xs text-gray-500 hover:text-gray-300 uppercase tracking-widest transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
