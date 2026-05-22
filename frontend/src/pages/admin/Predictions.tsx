import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { formatKickoff } from '../../lib/fmt'
import type { Match, Prediction, Profile, Tournament } from '../../types/database'

interface PredictionWithUser extends Prediction {
  profiles: { display_name: string } | null
}

export function AdminPredictions() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [existing, setExisting] = useState<PredictionWithUser[]>([])

  const [tournamentId, setTournamentId] = useState('')
  const [matchId, setMatchId] = useState('')
  const [userId, setUserId] = useState('')
  const [home, setHome] = useState(0)
  const [away, setAway] = useState(0)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Load tournaments + active members once
  useEffect(() => {
    supabase.from('tournaments').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTournaments(data ?? []))
    supabase.from('profiles').select('*').eq('status', 'active').order('display_name')
      .then(({ data }) => setMembers(data ?? []))
  }, [])

  // Load upcoming matches when tournament changes
  useEffect(() => {
    if (!tournamentId) { setMatches([]); setMatchId(''); return }
    supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .gt('kickoff_at', new Date().toISOString())
      .in('status', ['SCHEDULED', 'TIMED'])
      .order('kickoff_at')
      .then(({ data }) => { setMatches(data ?? []); setMatchId('') })
  }, [tournamentId])

  // Load existing predictions when match changes
  useEffect(() => {
    if (!matchId) { setExisting([]); return }
    supabase
      .from('predictions')
      .select('*, profiles(display_name)')
      .eq('match_id', matchId)
      .order('submitted_at')
      .then(({ data }) => setExisting((data as PredictionWithUser[]) ?? []))
  }, [matchId])

  async function submit() {
    if (!matchId || !userId) { setError('Select a match and a player.'); return }
    setSaving(true); setError(null); setSuccess(null)
    const { error: e } = await supabase.rpc('admin_submit_prediction', {
      p_user_id: userId,
      p_match_id: matchId,
      p_predicted_home: home,
      p_predicted_away: away,
    })
    if (e) setError(e.message)
    else {
      setSuccess('Prediction saved.')
      // Refresh existing predictions
      const { data } = await supabase
        .from('predictions')
        .select('*, profiles(display_name)')
        .eq('match_id', matchId)
        .order('submitted_at')
      setExisting((data as PredictionWithUser[]) ?? [])
    }
    setSaving(false)
  }

  const selectedMatch = matches.find((m) => m.id === matchId)

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
          <h1 className="font-serif text-3xl font-bold text-white mt-1">Predictions</h1>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {/* Form */}
          <div className="glass rounded-2xl p-5 space-y-4">
            <h2 className="text-white font-semibold">Submit on behalf of player</h2>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Tournament</label>
              <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                <option value="">Select tournament</option>
                {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Match (upcoming only)</label>
              <select value={matchId} onChange={(e) => setMatchId(e.target.value)} disabled={!tournamentId}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 disabled:opacity-50">
                <option value="">Select match</option>
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>{m.home_team} vs {m.away_team} · {formatKickoff(m.kickoff_at)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Player</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50">
                <option value="">Select player</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name} ({m.email})</option>)}
              </select>
            </div>

            {selectedMatch && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase tracking-widest">Predicted score</label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-1">
                    <p className="text-[10px] text-gray-500 truncate">{selectedMatch.home_team}</p>
                    <input type="number" min={0} value={home} onChange={(e) => setHome(Number(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-center text-2xl font-bold focus:outline-none focus:border-gold/50" />
                  </div>
                  <span className="text-gray-500 text-sm pt-4">vs</span>
                  <div className="flex-1 space-y-1">
                    <p className="text-[10px] text-gray-500 truncate">{selectedMatch.away_team}</p>
                    <input type="number" min={0} value={away} onChange={(e) => setAway(Number(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-center text-2xl font-bold focus:outline-none focus:border-gold/50" />
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}

            <button onClick={submit} disabled={saving || !matchId || !userId}
              className="w-full bg-gold hover:bg-gold-light text-charcoal py-2.5 rounded-full font-bold text-sm transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Submit prediction'}
            </button>
          </div>

          {/* Existing predictions for selected match */}
          <div className="space-y-3">
            <h2 className="text-white font-semibold">
              {matchId ? `Predictions for ${selectedMatch?.home_team} vs ${selectedMatch?.away_team}` : 'Select a match to see predictions'}
            </h2>
            {existing.length === 0 && matchId && <p className="text-gray-500 text-sm">No predictions yet.</p>}
            {existing.map((p) => (
              <div key={p.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-white text-sm">{p.profiles?.display_name ?? '—'}</span>
                <span className="text-gold font-bold">{p.predicted_home} – {p.predicted_away}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
