import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Navbar } from '../components/Navbar'
import { formatIDR } from '../lib/fmt'
import { useAuth } from '../hooks/useAuth'
import type { Tournament, LeaderboardRow } from '../types/database'

interface TournamentCard {
  tournament: Tournament
  balance: number | null
  rank: number | null
}

export function Dashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [cards, setCards] = useState<TournamentCard[]>([])
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
        const board = (data ?? []) as LeaderboardRow[]
        const idx = board.findIndex((r) => r.user_id === profile!.id)
        return {
          tournament: t as Tournament,
          balance: idx >= 0 ? board[idx].balance_idr : null,
          rank:    idx >= 0 ? idx + 1 : null,
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
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map(({ tournament: t, balance, rank }) => (
              <button
                key={t.id}
                onClick={() => navigate(`/tournaments/${t.id}`)}
                className="glass rounded-2xl p-5 text-left hover:border-gold/30 border border-transparent transition-all group space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-white font-semibold group-hover:text-gold transition-colors leading-tight">
                      {t.name}
                    </h2>
                    <p className="text-gray-500 text-xs mt-0.5">{formatIDR(t.stake_idr)}/match</p>
                  </div>
                  <Trophy size={16} className="text-gold shrink-0 mt-0.5" />
                </div>

                {balance != null && rank != null ? (
                  <div className="flex items-end gap-5">
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Balance</p>
                      <p className={`text-xl font-bold ${balance > 0 ? 'text-green-400' : balance < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {balance > 0 ? '+' : ''}{formatIDR(balance)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-0.5">Rank</p>
                      <p className="text-xl font-bold text-white">#{rank}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-600 text-xs italic">No predictions yet</p>
                )}

                <div className="flex items-center gap-1 text-gold text-xs font-bold uppercase tracking-widest group-hover:text-gold-light transition-colors">
                  View matches <ChevronRight size={12} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
