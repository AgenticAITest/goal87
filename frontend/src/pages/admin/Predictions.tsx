import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { formatKickoff } from '../../lib/fmt'
import type { Match, Prediction, Profile, Tournament } from '../../types/database'

// ── Team badge helpers ──────────────────────────────────────────────────────
const TEAM_FLAGS: Record<string, string> = {
  'Afghanistan': '🇦🇫', 'Albania': '🇦🇱', 'Algeria': '🇩🇿',
  'Angola': '🇦🇴', 'Argentina': '🇦🇷', 'Armenia': '🇦🇲',
  'Australia': '🇦🇺', 'Austria': '🇦🇹', 'Azerbaijan': '🇦🇿',
  'Bahrain': '🇧🇭', 'Bangladesh': '🇧🇩', 'Belgium': '🇧🇪',
  'Bolivia': '🇧🇴', 'Bosnia and Herzegovina': '🇧🇦',
  'Brazil': '🇧🇷', 'Brunei': '🇧🇳', 'Bulgaria': '🇧🇬',
  'Cambodia': '🇰🇭', 'Cameroon': '🇨🇲', 'Canada': '🇨🇦',
  'Chile': '🇨🇱', 'China': '🇨🇳', 'China PR': '🇨🇳',
  'Colombia': '🇨🇴', 'Congo': '🇨🇬', 'Costa Rica': '🇨🇷',
  'Croatia': '🇭🇷', 'Cyprus': '🇨🇾',
  'Czech Republic': '🇨🇿', 'Czechia': '🇨🇿',
  'Denmark': '🇩🇰', 'Ecuador': '🇪🇨', 'Egypt': '🇪🇬',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Estonia': '🇪🇪', 'Ethiopia': '🇪🇹',
  'Finland': '🇫🇮', 'France': '🇫🇷', 'Georgia': '🇬🇪',
  'Germany': '🇩🇪', 'Ghana': '🇬🇭', 'Greece': '🇬🇷',
  'Guatemala': '🇬🇹', 'Guinea': '🇬🇳', 'Honduras': '🇭🇳',
  'Hungary': '🇭🇺', 'Iceland': '🇮🇸', 'India': '🇮🇳',
  'Indonesia': '🇮🇩', 'Iran': '🇮🇷', 'Iraq': '🇮🇶',
  'Ireland': '🇮🇪', 'Israel': '🇮🇱', 'Italy': '🇮🇹',
  "Côte d'Ivoire": '🇨🇮', 'Ivory Coast': '🇨🇮',
  'Jamaica': '🇯🇲', 'Japan': '🇯🇵', 'Jordan': '🇯🇴',
  'Kazakhstan': '🇰🇿', 'Kenya': '🇰🇪', 'Kuwait': '🇰🇼',
  'Kyrgyzstan': '🇰🇬', 'Laos': '🇱🇦', 'Latvia': '🇱🇻',
  'Lebanon': '🇱🇧', 'Lithuania': '🇱🇹', 'Luxembourg': '🇱🇺',
  'Malaysia': '🇲🇾', 'Mali': '🇲🇱', 'Mexico': '🇲🇽',
  'Moldova': '🇲🇩', 'Mongolia': '🇲🇳', 'Montenegro': '🇲🇪',
  'Morocco': '🇲🇦', 'Myanmar': '🇲🇲', 'Nepal': '🇳🇵',
  'Netherlands': '🇳🇱', 'New Zealand': '🇳🇿', 'Nigeria': '🇳🇬',
  'North Korea': '🇰🇵', 'North Macedonia': '🇲🇰',
  'Norway': '🇳🇴', 'Oman': '🇴🇲', 'Pakistan': '🇵🇰',
  'Palestine': '🇵🇸', 'Panama': '🇵🇦', 'Paraguay': '🇵🇾',
  'Peru': '🇵🇪', 'Philippines': '🇵🇭', 'Poland': '🇵🇱',
  'Portugal': '🇵🇹', 'Qatar': '🇶🇦', 'Romania': '🇷🇴',
  'Russia': '🇷🇺', 'Saudi Arabia': '🇸🇦', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Senegal': '🇸🇳', 'Serbia': '🇷🇸', 'Singapore': '🇸🇬',
  'Slovakia': '🇸🇰', 'Slovenia': '🇸🇮', 'South Africa': '🇿🇦',
  'South Korea': '🇰🇷', 'Spain': '🇪🇸', 'Sri Lanka': '🇱🇰',
  'Sweden': '🇸🇪', 'Switzerland': '🇨🇭', 'Syria': '🇸🇾',
  'Taiwan': '🇹🇼', 'Tajikistan': '🇹🇯', 'Tanzania': '🇹🇿',
  'Thailand': '🇹🇭', 'Timor-Leste': '🇹🇱', 'Tunisia': '🇹🇳',
  'Turkey': '🇹🇷', 'Türkiye': '🇹🇷', 'Turkmenistan': '🇹🇲',
  'UAE': '🇦🇪', 'Uganda': '🇺🇬', 'Ukraine': '🇺🇦',
  'United Arab Emirates': '🇦🇪', 'United States': '🇺🇸',
  'Uruguay': '🇺🇾', 'USA': '🇺🇸', 'Uzbekistan': '🇺🇿',
  'Venezuela': '🇻🇪', 'Vietnam': '🇻🇳', 'Wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'Yemen': '🇾🇪', 'Zambia': '🇿🇲', 'Zimbabwe': '🇿🇼',
}

function teamColor(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return `hsl(${hash % 360},48%,32%)`
}

function TeamBadge({ name }: { name: string }) {
  const flag = TEAM_FLAGS[name]
  if (flag) {
    return (
      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[2rem] select-none">
        {flag}
      </div>
    )
  }
  const words = name.trim().split(/\s+/)
  const abbr = (words.length === 1
    ? name.slice(0, 3)
    : words.map(w => w[0]).join('').slice(0, 3)
  ).toUpperCase()
  return (
    <div
      style={{ backgroundColor: teamColor(name) }}
      className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-sm select-none"
    >
      {abbr}
    </div>
  )
}

function timeUntil(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0 || ms > 24 * 60 * 60 * 1000) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h === 0) return `in ${m}m`
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
}
// ───────────────────────────────────────────────────────────────────────────

interface PredictionWithUser extends Prediction {
  profiles: { display_name: string } | null
}

interface PredEntry { predicted_home: number; predicted_away: number }

export function AdminPredictions() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [members,     setMembers]     = useState<Profile[]>([])
  const [matches,     setMatches]     = useState<Match[]>([])
  const [playerPreds, setPlayerPreds] = useState<Record<string, PredEntry>>({})
  const [drafts,      setDrafts]      = useState<Record<string, { home: number; away: number }>>({})

  const [tournamentId,  setTournamentId]  = useState('')
  const [userId,        setUserId]        = useState('')
  const [submitting,    setSubmitting]    = useState<string | null>(null)
  const [editing,       setEditing]       = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  const [sidebarMatchId, setSidebarMatchId] = useState<string | null>(null)
  const [sidebarPreds,   setSidebarPreds]   = useState<PredictionWithUser[]>([])

  // Load tournaments + active members once
  useEffect(() => {
    supabase.from('tournaments').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setTournaments(data ?? []))
    supabase.from('profiles').select('*').eq('status', 'active').order('display_name')
      .then(({ data }) => setMembers(data ?? []))
  }, [])

  // Load upcoming matches when tournament changes
  useEffect(() => {
    if (!tournamentId) { setMatches([]); setSidebarMatchId(null); setPlayerPreds({}); return }
    supabase
      .from('matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .gt('kickoff_at', new Date().toISOString())
      .in('status', ['SCHEDULED', 'TIMED'])
      .order('kickoff_at')
      .then(({ data }) => {
        const list = (data ?? []) as Match[]
        setMatches(list)
        setSidebarMatchId(null)
        const d: Record<string, { home: number; away: number }> = {}
        for (const m of list) d[m.id] = { home: 0, away: 0 }
        setDrafts(d)
      })
  }, [tournamentId])

  // Load selected player's predictions across all matches
  useEffect(() => {
    if (!userId || matches.length === 0) { setPlayerPreds({}); setEditing(null); return }
    supabase
      .from('predictions')
      .select('match_id, predicted_home, predicted_away')
      .eq('user_id', userId)
      .in('match_id', matches.map(m => m.id))
      .then(({ data }) => {
        const map: Record<string, PredEntry> = {}
        for (const p of data ?? []) {
          map[p.match_id] = { predicted_home: p.predicted_home, predicted_away: p.predicted_away }
        }
        setPlayerPreds(map)
        setEditing(null)
        // Reset all drafts to 0, then fill from existing predictions
        setDrafts(() => {
          const d: Record<string, { home: number; away: number }> = {}
          for (const m of matches) d[m.id] = { home: 0, away: 0 }
          for (const [mid, pred] of Object.entries(map)) {
            d[mid] = { home: pred.predicted_home, away: pred.predicted_away }
          }
          return d
        })
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, matches])

  // Load all predictions for the sidebar match
  useEffect(() => {
    if (!sidebarMatchId) { setSidebarPreds([]); return }
    supabase
      .from('predictions')
      .select('*, profiles(display_name)')
      .eq('match_id', sidebarMatchId)
      .order('submitted_at')
      .then(({ data }) => setSidebarPreds((data as PredictionWithUser[]) ?? []))
  }, [sidebarMatchId])

  async function submitForMatch(matchId: string) {
    if (!userId) { setError('Select a player first.'); return }
    const draft = drafts[matchId]
    if (!draft) return
    setSubmitting(matchId); setError(null)

    const { error: e } = await supabase.rpc('admin_submit_prediction', {
      p_user_id:        userId,
      p_match_id:       matchId,
      p_predicted_home: draft.home,
      p_predicted_away: draft.away,
    })

    if (e) {
      setError(e.message)
    } else {
      setPlayerPreds(prev => ({ ...prev, [matchId]: { predicted_home: draft.home, predicted_away: draft.away } }))
      setEditing(null)
      if (sidebarMatchId === matchId) {
        supabase.from('predictions').select('*, profiles(display_name)')
          .eq('match_id', matchId).order('submitted_at')
          .then(({ data }) => setSidebarPreds((data as PredictionWithUser[]) ?? []))
      }
    }
    setSubmitting(null)
  }

  function setDraft(matchId: string, side: 'home' | 'away', value: number) {
    setDrafts(prev => ({ ...prev, [matchId]: { ...prev[matchId], [side]: value } }))
  }

  const sidebarMatch = matches.find(m => m.id === sidebarMatchId)
  const selectedPlayer = members.find(m => m.id === userId)

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        <div>
          <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
          <h1 className="font-serif text-3xl font-bold text-white mt-1">Predictions</h1>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-48 space-y-1">
            <label className="text-xs text-gray-400 uppercase tracking-widest">Tournament</label>
            <select
              value={tournamentId}
              onChange={(e) => setTournamentId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50"
            >
              <option value="">Select tournament</option>
              {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-48 space-y-1">
            <label className="text-xs text-gray-400 uppercase tracking-widest">Player</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50"
            >
              <option value="">Select player</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.display_name} ({m.email})</option>)}
            </select>
          </div>
        </div>

        {selectedPlayer && tournamentId && (
          <p className="text-xs text-gold">
            Submitting on behalf of <span className="font-bold">{selectedPlayer.display_name}</span>
          </p>
        )}

        {error && <div className="glass rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

        {!tournamentId ? (
          <p className="text-gray-500 text-sm">Select a tournament to see upcoming matches.</p>
        ) : matches.length === 0 ? (
          <p className="text-gray-500 text-sm">No upcoming matches in this tournament.</p>
        ) : (
          <div className="flex gap-6 items-start">

            {/* Match card grid */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {matches.map((m) => {
                  const pred       = playerPreds[m.id]
                  const draft      = drafts[m.id] ?? { home: 0, away: 0 }
                  const isEdit     = editing === m.id
                  const isSub      = submitting === m.id
                  const eta        = timeUntil(m.kickoff_at)
                  const isSelected = sidebarMatchId === m.id

                  return (
                    <div
                      key={m.id}
                      className={`glass rounded-2xl p-4 space-y-3 flex flex-col transition-all ${
                        isSelected ? 'border border-gold/40' : 'border border-transparent'
                      }`}
                    >
                      {/* Kickoff row — click to toggle sidebar */}
                      <button
                        onClick={() => setSidebarMatchId(isSelected ? null : m.id)}
                        className="flex items-center justify-between gap-2 w-full text-left"
                      >
                        <span className="text-xs text-gray-500 truncate">{formatKickoff(m.kickoff_at)}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {eta && (
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                              {eta}
                            </span>
                          )}
                          {isSelected && (
                            <span className="text-[10px] font-bold text-gold bg-gold/10 px-2 py-0.5 rounded-full">
                              viewing
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Teams */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                          <TeamBadge name={m.home_team} />
                          <p className="text-white text-xs font-medium text-center leading-snug line-clamp-2">
                            {m.home_team}
                          </p>
                        </div>
                        <span className="text-gray-600 text-xs font-bold shrink-0">VS</span>
                        <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                          <TeamBadge name={m.away_team} />
                          <p className="text-white text-xs font-medium text-center leading-snug line-clamp-2">
                            {m.away_team}
                          </p>
                        </div>
                      </div>

                      {/* Prediction area */}
                      <div className="border-t border-white/5 pt-3 mt-auto">
                        {!userId ? (
                          <p className="text-gray-600 text-xs italic text-center">Select a player above</p>
                        ) : isEdit || !pred ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest text-center">
                              {pred ? 'Edit prediction' : 'Enter prediction'}
                            </p>
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="number" min={0}
                                value={draft.home}
                                onChange={(e) => setDraft(m.id, 'home', Math.max(0, Number(e.target.value)))}
                                className="w-16 bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-white text-center text-xl font-bold focus:outline-none focus:border-gold/50"
                              />
                              <span className="text-gray-500 text-sm shrink-0">–</span>
                              <input
                                type="number" min={0}
                                value={draft.away}
                                onChange={(e) => setDraft(m.id, 'away', Math.max(0, Number(e.target.value)))}
                                className="w-16 bg-white/5 border border-white/10 rounded-xl px-2 py-2 text-white text-center text-xl font-bold focus:outline-none focus:border-gold/50"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => submitForMatch(m.id)}
                                disabled={isSub}
                                className="flex-1 bg-gold hover:bg-gold-light text-charcoal py-2 rounded-full text-xs font-bold transition-colors disabled:opacity-50"
                              >
                                {isSub ? '…' : pred ? 'Save' : 'Submit'}
                              </button>
                              {isEdit && (
                                <button
                                  onClick={() => setEditing(null)}
                                  className="text-gray-500 hover:text-white text-xs px-3 transition-colors"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-gray-500 text-xs">Submitted:</span>
                              <span className="text-white font-bold">{pred.predicted_home}–{pred.predicted_away}</span>
                            </div>
                            <button
                              onClick={() => {
                                setEditing(m.id)
                                setDrafts(d => ({ ...d, [m.id]: { home: pred.predicted_home, away: pred.predicted_away } }))
                              }}
                              className="text-xs text-gray-500 hover:text-gold transition-colors"
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Sidebar: all predictions for the clicked match */}
            <div className="hidden lg:block w-64 shrink-0 space-y-3 sticky top-6">
              <h2 className="text-xs text-gray-400 uppercase tracking-widest font-bold">
                {sidebarMatch
                  ? `${sidebarMatch.home_team} vs ${sidebarMatch.away_team}`
                  : 'All predictions'}
              </h2>
              {!sidebarMatch ? (
                <p className="text-gray-600 text-xs italic">Click a match card to see who predicted.</p>
              ) : sidebarPreds.length === 0 ? (
                <p className="text-gray-500 text-sm">No predictions yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {sidebarPreds.map((p) => (
                    <div key={p.id} className="glass rounded-xl px-4 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-white text-sm truncate">{p.profiles?.display_name ?? '—'}</span>
                      <span className="text-gold font-bold text-sm shrink-0">{p.predicted_home}–{p.predicted_away}</span>
                    </div>
                  ))}
                  <p className="text-gray-600 text-xs pt-1">{sidebarPreds.length} prediction{sidebarPreds.length !== 1 ? 's' : ''}</p>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
