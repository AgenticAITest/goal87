import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import { formatIDR } from '../lib/fmt'
import { useAuth } from '../hooks/useAuth'
import type { Tournament, LeaderboardRow } from '../types/database'

interface TournamentCard {
  tournament:  Tournament
  leaderboard: LeaderboardRow[]
  myBalance:   number | null
  myRank:      number | null
}

export function Dashboard() {
  const { profile } = useAuth()
  const navigate    = useNavigate()
  const [cards,   setCards]   = useState<TournamentCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function load() {
    setLoading(true)
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false })

    const list = tournaments ?? []

    const results = await Promise.all(
      list.map(async (t) => {
        const { data } = await supabase.rpc('leaderboard', { p_tournament_id: t.id })
        const board    = (data ?? []) as LeaderboardRow[]
        const idx      = board.findIndex((r) => r.user_id === profile!.id)
        return {
          tournament:  t as Tournament,
          leaderboard: board,
          myBalance:   idx >= 0 ? board[idx].balance_idr : null,
          myRank:      idx >= 0 ? idx + 1 : null,
        }
      })
    )

    setCards(results)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
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
            {cards.map(({ tournament: t, leaderboard, myBalance, myRank }) => (
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
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">My balance</p>
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

                {/* Row 2: standings grid */}
                {leaderboard.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 border-t border-white/5 pt-3">
                    {leaderboard.map((row, i) => {
                      const isMe = row.user_id === profile?.id
                      return (
                        <div
                          key={row.user_id}
                          className={`flex items-center gap-2 px-2 py-1 rounded-lg ${isMe ? 'bg-gold/10' : ''}`}
                        >
                          <span className={`text-[10px] font-bold shrink-0 ${isMe ? 'text-gold' : 'text-gray-600'}`}>
                            {i + 1}
                          </span>
                          <span className={`flex-1 truncate text-xs font-medium ${isMe ? 'text-gold' : 'text-gray-300'}`}>
                            {row.display_name.split(' ')[0]}
                          </span>
                          <span className={`text-xs font-bold tabular-nums shrink-0 ${
                            row.balance_idr > 0 ? 'text-green-400' :
                            row.balance_idr < 0 ? 'text-red-400'   : 'text-gray-500'
                          }`}>
                            {row.balance_idr > 0 ? '+' : ''}{formatIDR(row.balance_idr)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Row 3: actions */}
                <div className="flex items-center gap-3 border-t border-white/5 pt-3">
                  <div className="flex items-center gap-1 text-gold text-xs font-bold uppercase tracking-widest group-hover:text-gold-light transition-colors">
                    Full summary <ChevronRight size={12} />
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/tournaments/${t.id}`) }}
                    className="flex items-center gap-1 text-gray-500 hover:text-white text-xs uppercase tracking-widest transition-colors"
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
