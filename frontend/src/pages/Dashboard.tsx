import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import { formatIDR } from '../lib/fmt'
import { useAuth } from '../hooks/useAuth'
import type { Tournament, LeaderboardRow } from '../types/database'

interface Player { id: string; display_name: string; balance_idr: number }

interface LastMatch {
  id: string
  home_team: string
  away_team: string
  kickoff_at: string
  ft_home: number | null
  ft_away: number | null
}

interface TournamentCard {
  tournament:         Tournament
  leaderboard:        LeaderboardRow[]
  myBalance:          number | null
  myRank:             number | null
  lastMatches:        LastMatch[]
  settlementsByMatch: Record<string, Record<string, number>>  // matchId → userId → amount_idr
}

interface Clip { id: string; video_id: string; label: string | null }

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr].sort(() => Math.random() - 0.5)
  return copy.slice(0, n)
}

function balanceColor(current: number, baseline: number) {
  if (current > baseline) return 'text-green-400'
  if (current < baseline) return 'text-red-400'
  return 'text-gray-400'
}

export function Dashboard() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [cards,    setCards]    = useState<TournamentCard[]>([])
  const [players,  setPlayers]  = useState<Player[]>([])
  const [clips,    setClips]    = useState<Clip[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!profile) return
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function load() {
    setLoading(true)

    const [{ data: tournaments }, { data: allClips }, { data: profilesData }] = await Promise.all([
      supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
      supabase.from('highlight_clips').select('id,video_id,label'),
      supabase.from('profiles').select('id, display_name, balance_idr').eq('status', 'active').order('display_name'),
    ])
    setClips(pickRandom((allClips ?? []) as Clip[], 3))
    setPlayers((profilesData ?? []) as Player[])

    const list = tournaments ?? []

    const results = await Promise.all(
      list.map(async (t) => {
        // Fetch leaderboard and last-3-settled-matches in parallel
        const [{ data: boardData }, { data: last3Data }] = await Promise.all([
          supabase.rpc('leaderboard', { p_tournament_id: t.id }),
          supabase
            .from('matches')
            .select('id, home_team, away_team, kickoff_at, ft_home, ft_away')
            .eq('tournament_id', t.id)
            .not('settled_at', 'is', null)
            .order('settled_at', { ascending: false })
            .limit(3),
        ])

        const board      = (boardData ?? []) as LeaderboardRow[]
        const lastMatches = ((last3Data ?? []) as LastMatch[]).reverse() // chronological order

        // Fetch settlements for the last 3 matches
        let settlementsByMatch: Record<string, Record<string, number>> = {}
        if (lastMatches.length > 0) {
          const { data: settleData } = await supabase
            .from('settlements')
            .select('user_id, match_id, amount_idr')
            .in('match_id', lastMatches.map((m) => m.id))
            .eq('is_void', false)

          for (const s of settleData ?? []) {
            if (!settlementsByMatch[s.match_id]) settlementsByMatch[s.match_id] = {}
            settlementsByMatch[s.match_id][s.user_id] = s.amount_idr
          }
        }

        const idx = board.findIndex((r) => r.user_id === profile!.id)
        return {
          tournament:  t as Tournament,
          leaderboard: board,
          myBalance:   idx >= 0 ? board[idx].balance_idr : null,
          myRank:      idx >= 0 ? idx + 1 : null,
          lastMatches,
          settlementsByMatch,
        }
      })
    )

    setCards(results)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />

      {/* Highlight clips */}
      {clips.length > 0 && (
        <div className="w-full px-6 pt-6 pb-2">
          <div className="max-w-7xl mx-auto">
            <div className="flex gap-4 justify-center">
              {clips.map((clip) => (
                <div
                  key={clip.id}
                  className="relative w-48 shrink-0 overflow-hidden rounded-2xl bg-black shadow-2xl"
                  style={{ aspectRatio: '9/16' }}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${clip.video_id}?autoplay=1&mute=1&loop=1&playlist=${clip.video_id}&controls=0&rel=0&modestbranding=1&playsinline=1`}
                    className="absolute inset-0 w-full h-full"
                    allow="autoplay; encrypted-media; gyroscope"
                    title={clip.label ?? 'Highlight'}
                  />
                  <div className="absolute inset-0 z-10" />
                  {clip.label && (
                    <div className="absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-3 py-3 pointer-events-none">
                      <p className="text-white text-xs font-medium truncate">{clip.label}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        <div>
          <p className="text-xs text-gold uppercase tracking-[0.3em]">Welcome back</p>
          <h1 className="font-serif text-3xl font-bold text-white mt-1">{profile?.display_name}</h1>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : cards.length === 0 ? (
          <p className="text-gray-500 text-sm">No open tournaments right now.</p>
        ) : (
          <div className="space-y-4">
            {cards.map(({ tournament: t, leaderboard, myBalance, myRank, lastMatches, settlementsByMatch }) => (
              <div
                key={t.id}
                onClick={() => navigate(`/tournaments/${t.id}/summary`)}
                className="glass rounded-2xl border border-transparent hover:border-gold/30 transition-all cursor-pointer group p-5 space-y-4"
              >
                {/* Row 1: title + my stats */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-white font-semibold group-hover:text-gold transition-colors leading-tight">
                      {t.name}
                    </h2>
                    <p className="text-gray-500 text-xs mt-0.5">{formatIDR(t.stake_idr)} / match</p>
                  </div>

                  {myBalance != null && myRank != null ? (
                    <div className="flex items-end gap-5 shrink-0">
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">My P&L</p>
                        <p className={`text-lg font-bold ${myBalance > 0 ? 'text-green-400' : myBalance < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                          {myBalance > 0 ? '+' : ''}{formatIDR(myBalance)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Rank</p>
                        <p className="text-lg font-bold text-white">#{myRank}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-600 text-xs italic shrink-0">No predictions yet</p>
                  )}
                </div>

                {/* Mini-summary: last 3 settled matches with running balances */}
                {lastMatches.length > 0 && players.length > 0 && (
                  <div className="overflow-x-auto -mx-5 px-5 border-t border-white/5 pt-3">
                    <table className="w-full text-xs border-collapse min-w-max">
                      <thead>
                        <tr>
                          <th className="text-left text-gray-600 text-[10px] font-normal py-1 pr-4 w-36 whitespace-nowrap" />
                          {players.map((pl) => (
                            <th
                              key={pl.id}
                              className={`text-center text-[10px] font-bold py-1 px-3 min-w-24 ${pl.id === profile?.id ? 'text-gold' : 'text-gray-400'}`}
                            >
                              {pl.display_name.split(' ')[0]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Start row: balance before the last 3 matches */}
                        <tr className="border-t border-white/5 bg-white/[0.02]">
                          <td className="text-gray-500 py-1.5 pr-4 text-[10px] uppercase tracking-widest whitespace-nowrap">
                            Start
                          </td>
                          {players.map((pl) => {
                            const tournamentPL = leaderboard.find((r) => r.user_id === pl.id)?.balance_idr ?? 0
                            const last3PL = lastMatches.reduce(
                              (sum, m) => sum + (settlementsByMatch[m.id]?.[pl.id] ?? 0), 0
                            )
                            const startBal = pl.balance_idr + tournamentPL - last3PL
                            return (
                              <td key={pl.id} className="text-center py-1.5 px-3 text-gray-400 whitespace-nowrap">
                                {startBal !== 0 ? formatIDR(startBal) : <span className="text-gray-600">—</span>}
                              </td>
                            )
                          })}
                        </tr>

                        {/* One row per settled match */}
                        {lastMatches.map((m) => (
                          <tr key={m.id} className="border-t border-white/5">
                            <td className="text-gray-500 py-1.5 pr-4 whitespace-nowrap">
                              <span className="text-gray-600 mr-1">
                                {m.ft_home != null ? `${m.ft_home}–${m.ft_away}` : ''}
                              </span>
                              {m.home_team.split(' ')[0]} vs {m.away_team.split(' ')[0]}
                            </td>
                            {players.map((pl) => {
                              const amount = settlementsByMatch[m.id]?.[pl.id]
                              return (
                                <td
                                  key={pl.id}
                                  className={`text-center py-1.5 px-3 font-bold whitespace-nowrap ${
                                    amount == null  ? 'text-gray-600' :
                                    amount > 0      ? 'text-green-400' :
                                    amount < 0      ? 'text-red-400'   : 'text-gray-500'
                                  }`}
                                >
                                  {amount == null
                                    ? '—'
                                    : amount === 0
                                    ? 'void'
                                    : `${amount > 0 ? '+' : ''}${formatIDR(amount)}`}
                                </td>
                              )
                            })}
                          </tr>
                        ))}

                        {/* End row: current balance */}
                        <tr className="border-t border-white/10 bg-white/[0.02]">
                          <td className="text-white py-2 pr-4 text-[10px] uppercase tracking-widest font-bold whitespace-nowrap">
                            Balance
                          </td>
                          {players.map((pl) => {
                            const tournamentPL = leaderboard.find((r) => r.user_id === pl.id)?.balance_idr ?? 0
                            const currentBal = pl.balance_idr + tournamentPL
                            return (
                              <td
                                key={pl.id}
                                className={`text-center py-2 px-3 font-bold text-sm whitespace-nowrap ${balanceColor(currentBal, pl.balance_idr)}`}
                              >
                                {formatIDR(currentBal)}
                              </td>
                            )
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 border-t border-white/5 pt-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/tournaments/${t.id}/summary`) }}
                    className="flex items-center gap-1.5 bg-gold/10 hover:bg-gold/20 border border-gold/30 text-gold px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Details <ChevronRight size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/tournaments/${t.id}`) }}
                    className="flex items-center gap-1.5 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    <ListChecks size={11} /> Predict
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
