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
                className="glass rounded-2xl border border-transparent hover:border-gold/30 transition-all cursor-pointer group"
              >
                <div className="flex flex-col sm:flex-row">

                  {/* Left: tournament info */}
                  <div className="flex-1 p-5 space-y-4">
                    <div>
                      <h2 className="text-white font-semibold group-hover:text-gold transition-colors leading-tight">
                        {t.name}
                      </h2>
                      <p className="text-gray-500 text-xs mt-0.5">{formatIDR(t.stake_idr)} / match</p>
                    </div>

                    {myBalance != null && myRank != null ? (
                      <div className="flex items-end gap-5">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">My balance</p>
                          <p className={`text-xl font-bold ${myBalance > 0 ? 'text-green-400' : myBalance < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                            {myBalance > 0 ? '+' : ''}{formatIDR(myBalance)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Rank</p>
                          <p className="text-xl font-bold text-white">#{myRank}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-600 text-xs italic">No predictions yet</p>
                    )}

                    <div className="flex items-center gap-3">
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

                  {/* Right: mini leaderboard */}
                  {leaderboard.length > 0 && (
                    <div className="sm:w-56 border-t sm:border-t-0 sm:border-l border-white/5 p-4 flex flex-col justify-center space-y-1">
                      <p className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-2">Standings</p>
                      {leaderboard.map((row, i) => {
                        const isMe = row.user_id === profile?.id
                        return (
                          <div
                            key={row.user_id}
                            className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${isMe ? 'bg-gold/10' : ''}`}
                          >
                            <span className={`w-4 text-right shrink-0 font-bold ${isMe ? 'text-gold' : 'text-gray-600'}`}>
                              {i + 1}
                            </span>
                            <span className={`flex-1 truncate font-medium ${isMe ? 'text-gold' : 'text-gray-300'}`}>
                              {row.display_name.split(' ')[0]}
                            </span>
                            <span className={`shrink-0 font-bold tabular-nums ${
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
