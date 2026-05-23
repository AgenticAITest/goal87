import { useEffect, useState } from 'react'
import { FlaskConical, Trash2, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { formatIDR } from '../../lib/fmt'
import type { Match, Tournament } from '../../types/database'

interface TestTournament extends Tournament {
  matches: Match[]
}

export function AdminSandbox() {
  const [tournaments, setTournaments] = useState<TestTournament[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [scores, setScores]           = useState<Record<string, { home: string; away: string }>>({})
  const [busy, setBusy]               = useState<string | null>(null)
  const [wiping, setWiping]           = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)

    const { data: ts, error: te } = await supabase
      .from('tournaments')
      .select('*')
      .eq('is_test', true)
      .order('created_at', { ascending: false })

    if (te) { setError(te.message); setLoading(false); return }

    const result: TestTournament[] = []
    for (const t of ts ?? []) {
      const { data: ms, error: me } = await supabase
        .from('matches')
        .select('*')
        .eq('tournament_id', t.id)
        .order('kickoff_at', { ascending: true })
      if (me) { setError(me.message); setLoading(false); return }
      result.push({ ...t, matches: ms ?? [] })
    }

    setTournaments(result)
    setLoading(false)
  }

  function setScore(matchId: string, field: 'home' | 'away', val: string) {
    setScores((prev) => ({ ...prev, [matchId]: { ...prev[matchId], [field]: val } }))
  }

  async function settle(matchId: string) {
    const s = scores[matchId]
    const home = parseInt(s?.home ?? '')
    const away = parseInt(s?.away ?? '')
    if (isNaN(home) || isNaN(away) || home < 0 || away < 0) {
      setError('Enter valid scores (0 or above) for this match.')
      return
    }
    setBusy(matchId)
    setError(null)

    const { error: e1 } = await supabase.rpc('admin_override_match_score', {
      p_match_id: matchId, p_ft_home: home, p_ft_away: away,
    })
    if (e1) { setError(e1.message); setBusy(null); return }

    const { error: e2 } = await supabase.rpc('admin_force_settle', {
      p_match_id: matchId,
    })
    if (e2) { setError(e2.message); setBusy(null); return }

    await load()
    setBusy(null)
  }

  async function wipeAll() {
    if (!confirm('Delete ALL test tournaments, fixtures, predictions, and settlements? This cannot be undone.')) return
    setWiping(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('admin_wipe_test_data')
    if (err) setError(err.message)
    else {
      setTournaments([])
      setError(`✓ Wiped ${data} test tournament${data !== 1 ? 's' : ''} and all related data.`)
    }
    setWiping(false)
  }

  const totalMatches = tournaments.reduce((a, t) => a + t.matches.length, 0)
  const unsettled    = tournaments.reduce((a, t) => a + t.matches.filter((m) => !m.settled_at).length, 0)

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
            <h1 className="font-serif text-3xl font-bold text-white mt-1">Sandbox</h1>
            <p className="text-gray-400 text-sm mt-1">Simulate match results and settle test tournaments.</p>
          </div>
          {tournaments.length > 0 && (
            <button
              onClick={wipeAll}
              disabled={wiping}
              className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-40"
            >
              <Trash2 size={14} />
              {wiping ? 'Wiping…' : 'Wipe All Test Data'}
            </button>
          )}
        </div>

        {error && (
          <div className={`glass rounded-xl px-4 py-3 text-sm ${error.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{error}</div>
        )}

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : tournaments.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center space-y-3">
            <FlaskConical size={36} className="text-gray-600 mx-auto" />
            <p className="text-gray-400 text-sm">No test tournaments yet.</p>
            <p className="text-gray-500 text-xs leading-relaxed">
              Go to <a href="/admin/tournaments" className="text-gold hover:underline">Tournaments</a>, create a new tournament,
              and check <strong className="text-gray-300">Test tournament</strong>.
              Then add fixtures with the <strong className="text-gray-300">Add Fixture</strong> button.
            </p>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-xs">
              {tournaments.length} test tournament{tournaments.length !== 1 ? 's' : ''} ·{' '}
              {totalMatches} fixture{totalMatches !== 1 ? 's' : ''} ·{' '}
              {unsettled} unsettled
            </p>

            {tournaments.map((t) => (
              <div key={t.id} className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-white font-semibold">{t.name}</h2>
                  <span className="text-[10px] uppercase tracking-widest text-gold bg-gold/10 px-2 py-0.5 rounded-full font-bold">test</span>
                  <span className="text-xs text-gray-500">{t.status} · {formatIDR(t.stake_idr)}/match</span>
                </div>

                {t.matches.length === 0 ? (
                  <p className="text-gray-500 text-sm pl-1">
                    No fixtures yet — add them via the{' '}
                    <a href="/admin/tournaments" className="text-gold hover:underline">Add Fixture</a> button.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {t.matches.map((m) => (
                      <div
                        key={m.id}
                        className="glass rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
                      >
                        <div className="min-w-0">
                          <p className="text-white text-sm font-medium">
                            {m.home_team} <span className="text-gray-500">vs</span> {m.away_team}
                          </p>
                          <p className="text-gray-500 text-xs mt-0.5">
                            {new Date(m.kickoff_at).toLocaleString()} · {m.status}
                            {m.settled_at && ` · settled`}
                          </p>
                        </div>

                        {m.settled_at ? (
                          <div className="flex items-center gap-2 text-green-400 text-sm font-bold shrink-0">
                            <CheckCircle2 size={16} />
                            {m.ft_home} – {m.ft_away}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={scores[m.id]?.home ?? ''}
                              onChange={(e) => setScore(m.id, 'home', e.target.value)}
                              className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-gold/50"
                            />
                            <span className="text-gray-500 text-sm">–</span>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={scores[m.id]?.away ?? ''}
                              onChange={(e) => setScore(m.id, 'away', e.target.value)}
                              className="w-14 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-sm text-center focus:outline-none focus:border-gold/50"
                            />
                            <button
                              onClick={() => settle(m.id)}
                              disabled={busy === m.id}
                              className="bg-gold hover:bg-gold-light disabled:opacity-40 text-charcoal px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                            >
                              {busy === m.id ? 'Settling…' : 'Settle'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
