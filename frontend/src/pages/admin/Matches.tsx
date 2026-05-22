import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { formatKickoff } from '../../lib/fmt'
import type { Match, MatchStatus, Tournament } from '../../types/database'

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:3001'

const PAGE = 20

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED:  'text-white bg-white/5',
  TIMED:      'text-white bg-white/5',
  IN_PLAY:    'text-yellow-400 bg-yellow-400/10',
  PAUSED:     'text-yellow-400 bg-yellow-400/10',
  FINISHED:   'text-gray-400 bg-white/5',
  POSTPONED:  'text-orange-400 bg-orange-400/10',
  CANCELLED:  'text-orange-400 bg-orange-400/10',
}

type FilterGroup = 'all' | 'upcoming' | 'live' | 'finished' | 'postponed'
const FILTER_STATUSES: Record<FilterGroup, MatchStatus[] | null> = {
  all:       null,
  upcoming:  ['SCHEDULED', 'TIMED'],
  live:      ['IN_PLAY', 'PAUSED'],
  finished:  ['FINISHED'],
  postponed: ['POSTPONED', 'CANCELLED'],
}

type ActionType = 'status' | 'score' | 'void' | 'settle' | 'recalculate'

interface ActionState {
  match: Match
  type: ActionType
  newStatus?: MatchStatus
  ftHome?: number
  ftAway?: number
}

export function AdminMatches() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [tournamentId, setTournamentId] = useState<string>('')
  const [matches, setMatches] = useState<Match[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<FilterGroup>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [menuMatch, setMenuMatch] = useState<Match | null>(null)
  const [menuPos, setMenuPos]     = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [syncing, setSyncing]     = useState(false)

  useEffect(() => {
    supabase.from('tournaments').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        setTournaments(data ?? [])
        if (data?.[0]) setTournamentId(data[0].id)
      })
  }, [])

  useEffect(() => {
    if (tournamentId) { setPage(0); loadMatches(0) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, filter])

  async function loadMatches(p: number) {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('matches')
      .select('*', { count: 'exact' })
      .eq('tournament_id', tournamentId)
      .order('kickoff_at')
      .range(p * PAGE, (p + 1) * PAGE - 1)

    const statuses = FILTER_STATUSES[filter]
    if (statuses) q = q.in('status', statuses)

    const { data, count, error } = await q
    if (error) setError(error.message)
    else { setMatches(data ?? []); setTotal(count ?? 0) }
    setLoading(false)
  }

  function changePage(delta: number) {
    const next = page + delta
    setPage(next)
    loadMatches(next)
  }

  async function runAction() {
    if (!action) return
    setBusy(true)
    setError(null)
    const { match, type } = action
    let err: string | null = null

    if (type === 'status' && action.newStatus) {
      const { error: e } = await supabase.rpc('admin_override_match_status', { p_match_id: match.id, p_new_status: action.newStatus })
      err = e?.message ?? null
    } else if (type === 'score' && action.ftHome !== undefined && action.ftAway !== undefined) {
      const { error: e } = await supabase.rpc('admin_override_match_score', { p_match_id: match.id, p_ft_home: action.ftHome, p_ft_away: action.ftAway })
      err = e?.message ?? null
    } else if (type === 'void') {
      const { error: e } = await supabase.rpc('void_match', { p_match_id: match.id, p_admin_id: null })
      err = e?.message ?? null
    } else if (type === 'settle') {
      const { error: e } = await supabase.rpc('admin_force_settle', { p_match_id: match.id })
      err = e?.message ?? null
    } else if (type === 'recalculate') {
      const { data: { user } } = await supabase.auth.getUser()
      const { error: e } = await supabase.rpc('recalculate_match', { p_match_id: match.id, p_admin_id: user?.id })
      err = e?.message ?? null
    }

    if (err) setError(err)
    else { setAction(null); loadMatches(page) }
    setBusy(false)
  }

  async function syncNow() {
    setSyncing(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${WORKER_URL}/poll-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) setError(json.error ?? 'Sync failed')
      else {
        // Brief delay then reload so the poller has time to write updates
        setTimeout(() => loadMatches(page), 3000)
      }
    } catch (e) {
      setError(String(e))
    }
    setSyncing(false)
  }

  const totalPages = Math.ceil(total / PAGE)

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
            <h1 className="font-serif text-3xl font-bold text-white mt-1">Matches</h1>
          </div>
          <button
            onClick={syncNow}
            disabled={syncing}
            className="flex items-center gap-2 glass px-4 py-2 rounded-full text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50 mt-1"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Scores'}
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <select
            value={tournamentId}
            onChange={(e) => setTournamentId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-gold/50"
          >
            <option value="">Select tournament</option>
            {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <div className="flex gap-2 flex-wrap">
            {(['all', 'upcoming', 'live', 'finished', 'postponed'] as FilterGroup[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-widest font-bold transition-colors ${filter === f ? 'bg-gold text-charcoal' : 'glass text-gray-400 hover:text-white'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="glass rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

        {!tournamentId ? (
          <p className="text-gray-500 text-sm">Select a tournament to view matches.</p>
        ) : loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : matches.length === 0 ? (
          <p className="text-gray-500 text-sm">No matches in this category. Try "Pull Fixtures" on the Tournaments page.</p>
        ) : (
          <>
            <div className="space-y-2">
              {matches.map((m) => (
                <div key={m.id} className="glass rounded-2xl px-5 py-3 flex items-center gap-4">
                  <div className="text-gray-500 text-xs w-28 shrink-0">{formatKickoff(m.kickoff_at)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{m.home_team} <span className="text-gray-500">vs</span> {m.away_team}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {m.ft_home !== null && m.ft_away !== null && (
                      <span className="text-gold font-bold text-sm">{m.ft_home}–{m.ft_away}</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold ${STATUS_STYLES[m.status] ?? 'text-gray-400'}`}>{m.status}</span>
                    {m.settled_at && <span className="text-[10px] text-green-400 uppercase tracking-widest">settled</span>}
                    {/* Actions menu */}
                    <button
                      className="text-gray-500 hover:text-white transition-colors p-1"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
                        setMenuMatch((prev) => prev?.id === m.id ? null : m)
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{total} matches · page {page + 1} of {totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => changePage(-1)} disabled={page === 0} className="glass px-3 py-1.5 rounded-full disabled:opacity-30 hover:text-white transition-colors">
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => changePage(1)} disabled={page >= totalPages - 1} className="glass px-3 py-1.5 rounded-full disabled:opacity-30 hover:text-white transition-colors">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions dropdown — fixed so it escapes backdrop-blur stacking contexts */}
      {menuMatch && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuMatch(null)} />
          <div
            className="fixed z-50 bg-[#1a1a1a] border border-white/10 rounded-xl py-1 w-48 shadow-2xl"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            {[
              { label: 'Status override', type: 'status'      as ActionType, disabled: false },
              { label: 'Score override',  type: 'score'       as ActionType, disabled: false },
              { label: 'Void match',      type: 'void'        as ActionType, disabled: false },
              { label: 'Force settle',    type: 'settle'      as ActionType, disabled: !!menuMatch.settled_at },
              { label: 'Recalculate',     type: 'recalculate' as ActionType, disabled: !menuMatch.settled_at },
            ].map(({ label, type, disabled }) => (
              <button
                key={type}
                disabled={disabled}
                onClick={() => {
                  setAction({ match: menuMatch, type, newStatus: menuMatch.status, ftHome: menuMatch.ft_home ?? 0, ftAway: menuMatch.ft_away ?? 0 })
                  setMenuMatch(null)
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Action modal */}
      {action && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="glass rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h2 className="font-serif text-xl font-bold text-white capitalize">
              {action.type.replace('_', ' ')}
            </h2>
            <p className="text-gray-400 text-sm">{action.match.home_team} vs {action.match.away_team}</p>

            {action.type === 'status' && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase tracking-widest">New status</label>
                <select
                  value={action.newStatus}
                  onChange={(e) => setAction((a) => a ? { ...a, newStatus: e.target.value as MatchStatus } : a)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50"
                >
                  {(['SCHEDULED','TIMED','IN_PLAY','PAUSED','FINISHED','POSTPONED','CANCELLED'] as MatchStatus[]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            {action.type === 'score' && (
              <div className="flex items-center gap-4">
                {[
                  { label: action.match.home_team, key: 'ftHome' as const },
                  { label: action.match.away_team, key: 'ftAway' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="flex-1 space-y-1">
                    <label className="text-xs text-gray-400 truncate block">{label}</label>
                    <input
                      type="number" min={0}
                      value={action[key]}
                      onChange={(e) => setAction((a) => a ? { ...a, [key]: Number(e.target.value) } : a)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-center text-2xl font-bold focus:outline-none focus:border-gold/50"
                    />
                  </div>
                ))}
              </div>
            )}

            {['void', 'settle', 'recalculate'].includes(action.type) && (
              <p className="text-gray-400 text-sm">
                {action.type === 'void' && 'Mark this match as void. Zero-amount settlements recorded for all participants.'}
                {action.type === 'settle' && 'Force-settle this match using the current score. Irreversible unless recalculated.'}
                {action.type === 'recalculate' && 'Void existing settlements and re-settle with the current score. Use after a score correction.'}
              </p>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={() => setAction(null)} className="flex-1 glass py-2.5 rounded-full text-sm text-gray-300 hover:text-white transition-colors">Cancel</button>
              <button onClick={runAction} disabled={busy} className="flex-1 bg-gold hover:bg-gold-light text-charcoal py-2.5 rounded-full font-bold text-sm transition-colors disabled:opacity-50">
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
