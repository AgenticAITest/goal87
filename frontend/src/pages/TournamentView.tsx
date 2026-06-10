import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import { formatKickoff, formatIDR } from '../lib/fmt'
import { useAuth } from '../hooks/useAuth'
import type { Match, MatchStatus, Tournament, LeaderboardRow } from '../types/database'

type FilterTab = 'upcoming' | 'live' | 'finished'

const UPCOMING_STATUSES: MatchStatus[] = ['SCHEDULED', 'TIMED']
const LIVE_STATUSES: MatchStatus[]     = ['IN_PLAY', 'PAUSED']
const FINISHED_STATUSES: MatchStatus[] = ['FINISHED', 'POSTPONED', 'CANCELLED']

interface PredEntry { predicted_home: number; predicted_away: number }
interface SettleEntry { amount_idr: number; is_winner: boolean; is_void: boolean }

const STATUS_STYLES: Record<string, string> = {
  SCHEDULED: 'text-white bg-white/5',
  TIMED:     'text-white bg-white/5',
  IN_PLAY:   'text-yellow-400 bg-yellow-400/10',
  PAUSED:    'text-yellow-400 bg-yellow-400/10',
  FINISHED:  'text-gray-400 bg-white/5',
  POSTPONED: 'text-orange-400 bg-orange-400/10',
  CANCELLED: 'text-orange-400 bg-orange-400/10',
}

export function TournamentView() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const navigate = useNavigate()

  const [tournament, setTournament]   = useState<Tournament | null>(null)
  const [matches, setMatches]         = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Record<string, PredEntry>>({})
  const [settlements, setSettlements] = useState<Record<string, SettleEntry>>({})
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])

  const [filter, setFilter]     = useState<FilterTab>('upcoming')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [editing, setEditing]   = useState<string | null>(null)
  const [drafts, setDrafts]     = useState<Record<string, { home: number; away: number }>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !profile) return
    loadAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id])

  useEffect(() => {
    if (!id || !profile) return

    const channel = supabase
      .channel(`tournament-live-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `tournament_id=eq.${id}` },
        (payload) => {
          setMatches((prev) => prev.map((m) => m.id === payload.new.id ? payload.new as Match : m))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter: `user_id=eq.${profile.id}` },
        (payload) => {
          const s = payload.new as { match_id: string; amount_idr: number; is_winner: boolean; is_void: boolean }
          if (!s?.match_id) return
          setSettlements((prev) => ({
            ...prev,
            [s.match_id]: { amount_idr: s.amount_idr, is_winner: s.is_winner, is_void: s.is_void },
          }))
          supabase.rpc('leaderboard', { p_tournament_id: id })
            .then(({ data }) => { if (data) setLeaderboard(data as LeaderboardRow[]) })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id])

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [{ data: t }, { data: m }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase.from('matches').select('*').eq('tournament_id', id).order('kickoff_at'),
    ])

    if (!t) { setError('Tournament not found.'); setLoading(false); return }

    const matchList = (m ?? []) as Match[]
    const matchIds  = matchList.map((x) => x.id)

    const [{ data: p }, { data: s }, { data: board }] = await Promise.all([
      supabase.from('predictions')
        .select('match_id, predicted_home, predicted_away')
        .eq('user_id', profile!.id)
        .in('match_id', matchIds),
      supabase.from('settlements')
        .select('match_id, amount_idr, is_winner, is_void')
        .eq('user_id', profile!.id)
        .in('match_id', matchIds),
      supabase.rpc('leaderboard', { p_tournament_id: id }),
    ])

    const predMap: Record<string, PredEntry> = {}
    for (const x of p ?? []) predMap[x.match_id] = { predicted_home: x.predicted_home, predicted_away: x.predicted_away }

    const settleMap: Record<string, SettleEntry> = {}
    for (const x of s ?? []) settleMap[x.match_id] = { amount_idr: x.amount_idr, is_winner: x.is_winner, is_void: x.is_void }

    // Initialise drafts from existing predictions, else 0–0
    const initDrafts: Record<string, { home: number; away: number }> = {}
    for (const mx of matchList) {
      const pred = predMap[mx.id]
      initDrafts[mx.id] = { home: pred?.predicted_home ?? 0, away: pred?.predicted_away ?? 0 }
    }

    setTournament(t as Tournament)
    setMatches(matchList)
    setPredictions(predMap)
    setSettlements(settleMap)
    setLeaderboard((board ?? []) as LeaderboardRow[])
    setDrafts(initDrafts)
    setLoading(false)
  }

  async function submitPrediction(matchId: string) {
    const draft = drafts[matchId]
    if (!draft || !profile) return
    setSubmitting(matchId)
    setError(null)

    const { error: e } = await supabase.from('predictions').upsert({
      user_id:        profile.id,
      match_id:       matchId,
      predicted_home: draft.home,
      predicted_away: draft.away,
      submitted_by:   profile.id,
      submitted_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,match_id' })

    if (e) {
      setError(e.message)
    } else {
      setPredictions((prev) => ({
        ...prev,
        [matchId]: { predicted_home: draft.home, predicted_away: draft.away },
      }))
      setEditing(null)
    }
    setSubmitting(null)
  }

  function setDraft(matchId: string, side: 'home' | 'away', value: number) {
    setDrafts((prev) => ({ ...prev, [matchId]: { ...prev[matchId], [side]: value } }))
  }

  const now = new Date()
  // Test-tournament admins can predict regardless of kickoff time (sandbox testing flow)
  const isTestAdmin = !!tournament?.is_test && !!profile?.is_admin
  const isLocked = (m: Match) =>
    isTestAdmin
      ? !UPCOMING_STATUSES.includes(m.status)
      : new Date(m.kickoff_at) <= now || !UPCOMING_STATUSES.includes(m.status)

  const filtered = matches.filter((m) => {
    if (filter === 'upcoming') return UPCOMING_STATUSES.includes(m.status)
    if (filter === 'live')     return LIVE_STATUSES.includes(m.status)
    return FINISHED_STATUSES.includes(m.status)
  })

  const counts = {
    upcoming: matches.filter((m) => UPCOMING_STATUSES.includes(m.status)).length,
    live:     matches.filter((m) => LIVE_STATUSES.includes(m.status)).length,
    finished: matches.filter((m) => FINISHED_STATUSES.includes(m.status)).length,
  }

  const unpredictedCount = matches.filter(
    (m) => UPCOMING_STATUSES.includes(m.status) && !predictions[m.id]
  ).length

  const myLeaderboardEntry = leaderboard.find((r) => r.user_id === profile?.id)
  const myRank = myLeaderboardEntry ? leaderboard.indexOf(myLeaderboardEntry) + 1 : null

  if (loading) {
    return (
      <div className="min-h-screen bg-charcoal">
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-gray-500 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-charcoal">
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-red-400 text-sm">{error ?? 'Tournament not found.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-gray-500 hover:text-white text-xs uppercase tracking-widest transition-colors mb-4"
          >
            <ArrowLeft size={12} /> Back
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-gold uppercase tracking-[0.3em]">Tournament</p>
              <h1 className="font-serif text-3xl font-bold text-white mt-1">{tournament.name}</h1>
              <p className="text-gray-500 text-sm mt-1">{formatIDR(tournament.stake_idr)}/match stake</p>
            </div>
            {myLeaderboardEntry && myRank && (
              <div className="glass rounded-2xl px-5 py-3 flex gap-6 shrink-0">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">Your balance</p>
                  <p className={`text-xl font-bold mt-0.5 ${
                    myLeaderboardEntry.balance_idr > 0 ? 'text-green-400' :
                    myLeaderboardEntry.balance_idr < 0 ? 'text-red-400' : 'text-gray-400'
                  }`}>
                    {myLeaderboardEntry.balance_idr > 0 ? '+' : ''}{formatIDR(myLeaderboardEntry.balance_idr)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-widest">Rank</p>
                  <p className="text-xl font-bold text-white mt-0.5">#{myRank}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {unpredictedCount > 0 && (
          <div className="glass border border-gold/20 rounded-xl px-4 py-3 text-sm text-gold">
            {unpredictedCount} upcoming match{unpredictedCount > 1 ? 'es' : ''} need your prediction.
          </div>
        )}

        {error && <div className="glass rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

        <div className="flex gap-4 flex-wrap lg:items-start">

          {/* Matches column */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {(['upcoming', 'live', 'finished'] as FilterTab[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-widest font-bold transition-colors flex items-center gap-1.5 ${
                    filter === f ? 'bg-gold text-charcoal' : 'glass text-gray-400 hover:text-white'
                  }`}
                >
                  {f}
                  {counts[f] > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] ${filter === f ? 'bg-charcoal/20' : 'bg-white/10'}`}>
                      {counts[f]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <p className="text-gray-500 text-sm">No {filter} matches.</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((m) => {
                  const pred    = predictions[m.id]
                  const settle  = settlements[m.id]
                  const draft   = drafts[m.id] ?? { home: 0, away: 0 }
                  const locked  = isLocked(m)
                  const isEdit  = editing === m.id
                  const isSub   = submitting === m.id
                  const isLive  = LIVE_STATUSES.includes(m.status)
                  const isDone  = FINISHED_STATUSES.includes(m.status)

                  return (
                    <div key={m.id} className="glass rounded-2xl px-5 py-4 space-y-3">
                      {/* Match row */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-gray-500 text-xs shrink-0">{formatKickoff(m.kickoff_at)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">
                            {m.home_team} <span className="text-gray-500">vs</span> {m.away_team}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {m.ft_home != null && m.ft_away != null && (
                            <span className="text-gold font-bold text-sm">{m.ft_home}–{m.ft_away}</span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold ${STATUS_STYLES[m.status] ?? 'text-gray-400'}`}>
                            {isLive ? '● Live' : m.status}
                          </span>
                        </div>
                      </div>

                      {/* Prediction area */}
                      {isDone ? (
                        /* Finished: show outcome */
                        <div className="border-t border-white/5 pt-3">
                          {pred ? (
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-gray-500">Your pick:</span>
                                <span className="text-white font-bold">{pred.predicted_home}–{pred.predicted_away}</span>
                                {settle && !settle.is_void && (
                                  <span className={`text-xs font-bold ${settle.is_winner ? 'text-green-400' : 'text-red-400'}`}>
                                    {settle.is_winner ? '✓' : '✗'}
                                  </span>
                                )}
                              </div>
                              {settle && (
                                <span className={`text-sm font-bold ${
                                  settle.is_void ? 'text-gray-500' :
                                  settle.amount_idr >= 0 ? 'text-green-400' : 'text-red-400'
                                }`}>
                                  {settle.is_void ? 'Void' : `${settle.amount_idr >= 0 ? '+' : ''}${formatIDR(settle.amount_idr)}`}
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="text-gray-600 text-xs italic">No prediction made</p>
                          )}
                        </div>
                      ) : locked && pred ? (
                        /* Live or kicked off — show prediction locked */
                        <div className="border-t border-white/5 pt-3 flex items-center gap-2 text-sm">
                          <Lock size={11} className="text-gray-600" />
                          <span className="text-gray-500">Your pick:</span>
                          <span className="text-white font-bold">{pred.predicted_home}–{pred.predicted_away}</span>
                        </div>
                      ) : locked && !pred ? (
                        /* Kicked off, no prediction */
                        <div className="border-t border-white/5 pt-3 flex items-center gap-2 text-sm">
                          <Lock size={11} className="text-gray-600" />
                          <span className="text-gray-600 italic text-xs">No prediction made</span>
                        </div>
                      ) : isEdit || !pred ? (
                        /* Prediction form */
                        <div className="border-t border-white/5 pt-3 space-y-2">
                          <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                            {pred ? 'Edit prediction' : 'Your prediction'}
                          </p>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 space-y-1">
                              <p className="text-[10px] text-gray-500 truncate">{m.home_team}</p>
                              <input
                                type="number" min={0}
                                value={draft.home}
                                onChange={(e) => setDraft(m.id, 'home', Math.max(0, Number(e.target.value)))}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-center text-xl font-bold focus:outline-none focus:border-gold/50"
                              />
                            </div>
                            <span className="text-gray-500 text-sm pt-4">–</span>
                            <div className="flex-1 space-y-1">
                              <p className="text-[10px] text-gray-500 truncate">{m.away_team}</p>
                              <input
                                type="number" min={0}
                                value={draft.away}
                                onChange={(e) => setDraft(m.id, 'away', Math.max(0, Number(e.target.value)))}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-center text-xl font-bold focus:outline-none focus:border-gold/50"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5 pt-5">
                              <button
                                onClick={() => submitPrediction(m.id)}
                                disabled={isSub}
                                className="bg-gold hover:bg-gold-light text-charcoal px-4 py-2 rounded-full text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                              >
                                {isSub ? '…' : pred ? 'Save' : 'Submit'}
                              </button>
                              {isEdit && (
                                <button
                                  onClick={() => setEditing(null)}
                                  className="text-gray-500 hover:text-white text-xs text-center transition-colors"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Has prediction, not editing */
                        <div className="border-t border-white/5 pt-3 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-gray-500">Your pick:</span>
                            <span className="text-white font-bold">{pred.predicted_home}–{pred.predicted_away}</span>
                          </div>
                          <button
                            onClick={() => { setEditing(m.id); setDrafts((d) => ({ ...d, [m.id]: { home: pred.predicted_home, away: pred.predicted_away } })) }}
                            className="text-xs text-gray-500 hover:text-gold transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Leaderboard sidebar */}
          <div className="w-full lg:w-72 shrink-0 space-y-3">
            <h2 className="text-xs text-gray-400 uppercase tracking-widest font-bold">Leaderboard</h2>
            {leaderboard.length === 0 ? (
              <p className="text-gray-600 text-sm">No predictions yet.</p>
            ) : (
              <div className="space-y-1.5">
                {leaderboard.map((row, i) => {
                  const isMe = row.user_id === profile?.id
                  return (
                    <div
                      key={row.user_id}
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-colors ${
                        isMe ? 'bg-gold/10 border border-gold/20' : 'glass'
                      }`}
                    >
                      <span className={`w-5 text-right text-xs font-bold shrink-0 ${isMe ? 'text-gold' : 'text-gray-600'}`}>
                        {i + 1}
                      </span>
                      <span className={`flex-1 truncate font-medium ${isMe ? 'text-gold' : 'text-white'}`}>
                        {row.display_name}
                      </span>
                      <span className={`text-xs font-bold shrink-0 ${
                        row.balance_idr > 0 ? 'text-green-400' :
                        row.balance_idr < 0 ? 'text-red-400' : 'text-gray-500'
                      }`}>
                        {row.balance_idr > 0 ? '+' : ''}{formatIDR(row.balance_idr)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
