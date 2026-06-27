import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import { formatIDR } from '../lib/fmt'
import { useAuth } from '../hooks/useAuth'
import type { Match, Tournament } from '../types/database'

interface Player { id: string; display_name: string; balance_idr: number }

interface MatchSummary {
  match: Match
  preds:   Record<string, { home: number; away: number }>
  settles: Record<string, { amount: number; isWinner: boolean; isVoid: boolean }>
}

interface DateGroup {
  label:           string
  rows:            MatchSummary[]
  totalsBeforeGroup: Record<string, number>
}

function toDateLabel(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day:      'numeric',
    month:    'short',
  })
}

function balanceColor(n: number) {
  if (n > 0) return 'text-green-400'
  if (n < 0) return 'text-red-400'
  return 'text-gray-500'
}

function settleBg(amount: number, isVoid: boolean) {
  if (isVoid) return ''
  if (amount > 0) return 'bg-green-400/10'
  if (amount < 0) return 'bg-red-400/10'
  return 'bg-white/5'
}

export function TournamentSummary() {
  const { id }    = useParams<{ id: string }>()
  const { profile } = useAuth()
  const navigate  = useNavigate()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [players,    setPlayers]    = useState<Player[]>([])
  const [groups,     setGroups]     = useState<DateGroup[]>([])
  const [finalTotals, setFinalTotals] = useState<Record<string, number>>({})
  const [pendingRows, setPendingRows] = useState<MatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    setError(null)

    const [{ data: t }, { data: m }, { data: profs }] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase.from('matches').select('*').eq('tournament_id', id).order('kickoff_at'),
      supabase.from('profiles').select('id, display_name, balance_idr').eq('status', 'active').order('display_name'),
    ])

    if (!t) { setError('Tournament not found.'); setLoading(false); return }

    const matchList  = (m     ?? []) as Match[]
    const playerList = (profs ?? []) as Player[]
    const matchIds   = matchList.map((x) => x.id)

    const [{ data: p }, { data: l }] = await Promise.all([
      matchIds.length
        ? supabase.from('predictions').select('user_id,match_id,predicted_home,predicted_away').in('match_id', matchIds)
        : Promise.resolve({ data: [] }),
      // Ledger is now the source of truth for settled amounts + opening balances.
      supabase.from('ledger').select('user_id,match_id,entry_type,amount_idr,score').eq('tournament_id', id).order('seq'),
    ])

    // Index predictions (from predictions table) and settlements (from ledger) by match.
    const predsByMatch:   Record<string, Record<string, { home: number; away: number }>>                         = {}
    const settlesByMatch: Record<string, Record<string, { amount: number; isWinner: boolean; isVoid: boolean }>> = {}
    const openingByUser:  Record<string, number> = {}

    for (const x of p ?? []) {
      if (!predsByMatch[x.match_id]) predsByMatch[x.match_id] = {}
      predsByMatch[x.match_id][x.user_id] = { home: x.predicted_home, away: x.predicted_away }
    }
    // Iterated in seq order: a later settlement (e.g. after a recalc) overwrites the earlier one.
    for (const x of l ?? []) {
      if (x.entry_type === 'opening') { openingByUser[x.user_id] = x.amount_idr; continue }
      if (x.entry_type !== 'settlement' || !x.match_id) continue
      if (!settlesByMatch[x.match_id]) settlesByMatch[x.match_id] = {}
      settlesByMatch[x.match_id][x.user_id] = { amount: x.amount_idr, isWinner: x.amount_idr > 0, isVoid: x.score === 'void' }
    }

    const allRows: MatchSummary[] = matchList.map((match) => ({
      match,
      preds:   predsByMatch[match.id]   ?? {},
      settles: settlesByMatch[match.id] ?? {},
    }))

    // Split into settled (has settled_at) and pending
    const settled = allRows.filter((r) => r.match.settled_at)
    const pending = allRows.filter((r) => !r.match.settled_at)

    // Group settled rows by local date
    const groupMap = new Map<string, MatchSummary[]>()
    for (const r of settled) {
      const label = toDateLabel(r.match.kickoff_at)
      if (!groupMap.has(label)) groupMap.set(label, [])
      groupMap.get(label)!.push(r)
    }

    // Build groups with running totals before each.
    // Seed each player's running total from their ledger opening entry so
    // "Running Total · Start" shows their balance before any match in this tournament.
    // (profiles.balance_idr is now the *ending* total, not the opening.)
    const running: Record<string, number> = {}
    for (const pl of playerList) running[pl.id] = openingByUser[pl.id] ?? 0

    const builtGroups: DateGroup[] = []
    for (const [label, rows] of groupMap) {
      builtGroups.push({ label, rows, totalsBeforeGroup: { ...running } })
      for (const r of rows) {
        for (const pl of playerList) {
          const settle = r.settles[pl.id]
          if (settle) running[pl.id] = (running[pl.id] ?? 0) + settle.amount
        }
      }
    }

    setTournament(t as Tournament)
    setPlayers(playerList)
    setGroups(builtGroups)
    setFinalTotals({ ...running })
    setPendingRows(pending)
    setLoading(false)
  }

  if (loading) return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-gray-500 text-sm">Loading…</p>
      </div>
    </div>
  )

  if (!tournament) return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-red-400 text-sm">{error ?? 'Tournament not found.'}</p>
      </div>
    </div>
  )

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
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs text-gold uppercase tracking-[0.3em]">Summary</p>
              <h1 className="font-serif text-3xl font-bold text-white mt-1">{tournament.name}</h1>
              <p className="text-gray-500 text-sm mt-1">{formatIDR(tournament.stake_idr)} / match</p>
            </div>
            <button
              onClick={() => navigate(`/tournaments/${id}`)}
              className="flex items-center gap-2 glass px-4 py-2 rounded-full text-sm text-gray-300 hover:text-white transition-colors"
            >
              <ListChecks size={14} />
              My predictions
            </button>
          </div>
        </div>

        {groups.length === 0 && pendingRows.length === 0 && (
          <p className="text-gray-500 text-sm">No matches yet.</p>
        )}

        {/* Scrollable table */}
        {(groups.length > 0 || pendingRows.length > 0) && (
          <div className="overflow-auto rounded-2xl glass max-h-[70vh]">
            <table className="w-full text-sm border-collapse min-w-max">

              {/* Column headers — sticky to the top of the table's own scroll
                  area so player names stay visible while scrolling the match list */}
              <thead>
                <tr className="border-b border-white/10">
                  <th className="sticky top-0 z-30 bg-charcoal text-left text-gray-500 text-[10px] uppercase tracking-widest font-normal py-3 px-4 w-48 whitespace-nowrap">Match</th>
                  <th className="sticky top-0 z-30 bg-charcoal text-center text-gray-500 text-[10px] uppercase tracking-widest font-normal py-3 px-3 w-16">Score</th>
                  {players.map((pl) => (
                    <th
                      key={pl.id}
                      className={`sticky top-0 z-30 bg-charcoal text-center text-[10px] uppercase tracking-widest font-bold py-3 px-4 min-w-28 ${pl.id === profile?.id ? 'text-gold' : 'text-gray-300'}`}
                    >
                      {pl.display_name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {groups.map(({ label, rows, totalsBeforeGroup }, gi) => (
                  <Fragment key={label}>

                    {/* Running total before this date group */}
                    <tr className="border-b border-white/5 bg-white/3">
                      <td
                        colSpan={2}
                        className="py-2 px-4 text-[10px] text-gray-400 font-bold uppercase tracking-widest whitespace-nowrap"
                      >
                        Running Total · {gi === 0 ? 'Start' : groups[gi - 1].label}
                      </td>
                      {players.map((pl) => {
                        const n = totalsBeforeGroup[pl.id] ?? 0
                        return (
                          <td key={pl.id} className={`py-2 px-4 text-center text-xs font-bold ${balanceColor(n)}`}>
                            {n !== 0 ? formatIDR(n) : <span className="text-gray-600">—</span>}
                          </td>
                        )
                      })}
                    </tr>

                    {/* Matches in this date group */}
                    {rows.map((r) => (
                      <Fragment key={r.match.id}>

                        {/* Predictions row */}
                        <tr className="border-t border-white/5">
                          <td className="py-1.5 px-4 text-gray-400 text-xs whitespace-nowrap">
                            <span className="text-gray-600 text-[10px] mr-1">{toDateLabel(r.match.kickoff_at)}</span>
                            {r.match.home_team} <span className="text-gray-600">vs</span> {r.match.away_team}
                          </td>
                          <td className="py-1.5 px-3" />
                          {players.map((pl) => {
                            const pred = r.preds[pl.id]
                            return (
                              <td key={pl.id} className="py-1.5 px-4 text-center text-gray-400 text-xs">
                                {pred ? `${pred.home}–${pred.away}` : <span className="text-gray-700">—</span>}
                              </td>
                            )
                          })}
                        </tr>

                        {/* Settlement row */}
                        <tr className="border-b border-white/5">
                          <td className="pb-2 px-4" />
                          <td className="pb-2 px-3 text-center text-gold font-bold text-xs whitespace-nowrap">
                            {r.match.ft_home}–{r.match.ft_away}
                          </td>
                          {players.map((pl) => {
                            const settle = r.settles[pl.id]
                            return (
                              <td key={pl.id} className="pb-2 px-4 text-center">
                                {settle ? (
                                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${settleBg(settle.amount, settle.isVoid)} ${
                                    settle.isVoid         ? 'text-gray-500' :
                                    settle.amount > 0     ? 'text-green-400' :
                                    settle.amount < 0     ? 'text-red-400'   : 'text-gray-500'
                                  }`}>
                                    {settle.isVoid
                                      ? 'Void'
                                      : `${settle.amount > 0 ? '+' : ''}${formatIDR(settle.amount)}`}
                                  </span>
                                ) : (
                                  <span className="text-gray-700 text-xs">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>

                      </Fragment>
                    ))}
                  </Fragment>
                ))}

                {/* Final running total */}
                {groups.length > 0 && (
                  <tr className="border-t-2 border-white/10 bg-white/3">
                    <td
                      colSpan={2}
                      className="py-3 px-4 text-[10px] text-white font-bold uppercase tracking-widest whitespace-nowrap"
                    >
                      Running Total · {groups[groups.length - 1].label}
                    </td>
                    {players.map((pl) => {
                      const n = finalTotals[pl.id] ?? 0
                      return (
                        <td key={pl.id} className={`py-3 px-4 text-center text-sm font-bold ${balanceColor(n)}`}>
                          {formatIDR(n)}
                        </td>
                      )
                    })}
                  </tr>
                )}

                {/* Pending / upcoming matches */}
                {pendingRows.length > 0 && (
                  <>
                    <tr className="border-t border-white/10">
                      <td colSpan={2 + players.length} className="py-2 px-4 text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                        Upcoming & unsettled
                      </td>
                    </tr>
                    {pendingRows.map((r) => {
                      return (
                        <tr key={r.match.id} className="border-t border-white/5">
                          <td className="py-2 px-4 text-gray-400 text-xs whitespace-nowrap">
                            <span className="text-gray-500 text-[10px] mr-1">{toDateLabel(r.match.kickoff_at)}</span>
                            {r.match.home_team} <span className="text-gray-500">vs</span> {r.match.away_team}
                          </td>
                          <td className="py-2 px-3 text-center text-gray-500 text-xs">
                            {r.match.ft_home != null ? `${r.match.ft_home}–${r.match.ft_away}` : '—'}
                          </td>
                          {players.map((pl) => {
                            const pred = r.preds[pl.id]
                            return (
                              <td key={pl.id} className="py-2 px-4 text-center text-gray-400 text-xs">
                                {pred ? `${pred.home}–${pred.away}` : <span className="text-gray-500">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
