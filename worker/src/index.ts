import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { createClient } from '@supabase/supabase-js'

const app = express()
app.use(cors({ origin: ['http://localhost:5173', 'https://bola.top87.id'] }))
app.use(express.json())

const {
  SUPABASE_URL = '',
  SUPABASE_SERVICE_ROLE_KEY = '',
  FD_API_TOKEN = '',
  PORT = '3001',
  POLL_INTERVAL_MS = '60000',
} = process.env

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Auth helper ────────────────────────────────────────────────────────────
async function requireAdmin(req: express.Request, res: express.Response): Promise<string | null> {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) { res.status(401).json({ error: 'Missing token' }); return null }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) { res.status(401).json({ error: 'Invalid token' }); return null }

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) { res.status(403).json({ error: 'Forbidden' }); return null }

  return user.id
}

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, pollerRunning: !!FD_API_TOKEN }))

// ── List competitions ──────────────────────────────────────────────────────
app.get('/competitions', async (req, res) => {
  if (!await requireAdmin(req, res)) return

  try {
    const { data } = await axios.get<{ competitions: FdCompetition[] }>(
      'https://api.football-data.org/v4/competitions',
      { headers: { 'X-Auth-Token': FD_API_TOKEN } },
    )
    res.json(data.competitions)
  } catch (err: unknown) {
    const msg = axios.isAxiosError(err)
      ? `football-data.org: ${err.response?.status} ${err.response?.data?.message ?? err.message}`
      : String(err)
    res.status(502).json({ error: msg })
  }
})

// ── Pull fixtures ──────────────────────────────────────────────────────────
app.post('/pull-fixtures', async (req, res) => {
  if (!await requireAdmin(req, res)) return

  const { competition_code, season, tournament_id } = req.body as {
    competition_code: string
    season: number
    tournament_id: string
  }

  const missing = [
    !competition_code && 'competition_code',
    !season           && 'season',
    !tournament_id    && 'tournament_id',
  ].filter(Boolean)
  if (missing.length) {
    res.status(400).json({ error: `Missing: ${missing.join(', ')}` })
    return
  }

  let fdMatches: FdMatch[]
  try {
    const { data } = await axios.get<{ matches: FdMatch[] }>(
      `https://api.football-data.org/v4/competitions/${competition_code}/matches?season=${season}`,
      { headers: { 'X-Auth-Token': FD_API_TOKEN } },
    )
    fdMatches = data.matches
  } catch (err: unknown) {
    const msg = axios.isAxiosError(err)
      ? `football-data.org: ${err.response?.status} ${err.response?.data?.message ?? err.message}`
      : String(err)
    res.status(502).json({ error: msg })
    return
  }

  const rows = fdMatches.map((m) => ({
    tournament_id,
    api_match_id: m.id,
    home_team:    m.homeTeam?.name ?? m.homeTeam?.shortName ?? 'TBD',
    away_team:    m.awayTeam?.name ?? m.awayTeam?.shortName ?? 'TBD',
    kickoff_at:   m.utcDate,
    status:       normStatus(m.status),
    ft_home:      m.score?.fullTime?.home ?? null,
    ft_away:      m.score?.fullTime?.away ?? null,
  }))

  const { error: upsertErr } = await supabase
    .from('matches')
    .upsert(rows, { onConflict: 'api_match_id', ignoreDuplicates: false })

  if (upsertErr) { res.status(500).json({ error: upsertErr.message }); return }

  console.log(`[pull-fixtures] ${competition_code}/${season}: ${rows.length} matches upserted`)
  res.json({ total: rows.length })
})

// ── Manual poll trigger ────────────────────────────────────────────────────
app.post('/poll-now', async (req, res) => {
  if (!await requireAdmin(req, res)) return
  // Fire and forget — don't block the response
  pollScores().catch((err) => console.error('[poll-now]', err))
  res.json({ ok: true, message: 'Poll cycle started' })
})

// ── Score sync poller ──────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface SyncResult { settled: number; voided: number; updated: number }

async function syncTournament(t: {
  id: string
  api_competition_id: string
  api_season: number
}): Promise<SyncResult> {
  // Fetch a 4-day window: 2 days back (late results) to 2 days ahead (status changes)
  const now = new Date()
  const from = new Date(now); from.setDate(now.getDate() - 2)
  const to   = new Date(now); to.setDate(now.getDate() + 2)

  const { data } = await axios.get<{ matches: FdMatch[] }>(
    `https://api.football-data.org/v4/competitions/${t.api_competition_id}/matches`,
    {
      headers: { 'X-Auth-Token': FD_API_TOKEN },
      params:  { dateFrom: isoDate(from), dateTo: isoDate(to) },
    },
  )

  const polledAt = new Date().toISOString()
  const rows = data.matches.map((m) => ({
    tournament_id:  t.id,
    api_match_id:   m.id,
    home_team:      m.homeTeam?.name ?? m.homeTeam?.shortName ?? 'TBD',
    away_team:      m.awayTeam?.name ?? m.awayTeam?.shortName ?? 'TBD',
    kickoff_at:     m.utcDate,
    status:         normStatus(m.status),
    ft_home:        m.score?.fullTime?.home ?? null,
    ft_away:        m.score?.fullTime?.away ?? null,
    last_polled_at: polledAt,
  }))

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from('matches')
      .upsert(rows, { onConflict: 'api_match_id', ignoreDuplicates: false })
    if (upsertErr) throw new Error(`upsert: ${upsertErr.message}`)
  }

  // Settle FINISHED matches that have scores and are not yet settled.
  // Runs regardless of the API window — catches matches settled outside the date range.
  const { data: toSettle, error: settleQueryErr } = await supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', t.id)
    .eq('status', 'FINISHED')
    .is('settled_at', null)
    .not('ft_home', 'is', null)
    .not('ft_away', 'is', null)

  if (settleQueryErr) throw new Error(`settle query: ${settleQueryErr.message}`)

  let settled = 0
  for (const m of toSettle ?? []) {
    const { error } = await supabase.rpc('settle_match', { p_match_id: m.id })
    if (error) console.error(`[poller] settle_match(${m.id}): ${error.message}`)
    else { settled++; console.log(`[poller] settled ${m.id}`) }
  }

  // Void POSTPONED/CANCELLED matches that are not yet settled
  const { data: toVoid, error: voidQueryErr } = await supabase
    .from('matches')
    .select('id')
    .eq('tournament_id', t.id)
    .in('status', ['POSTPONED', 'CANCELLED'])
    .is('settled_at', null)

  if (voidQueryErr) throw new Error(`void query: ${voidQueryErr.message}`)

  let voided = 0
  for (const m of toVoid ?? []) {
    const { error } = await supabase.rpc('void_match', { p_match_id: m.id, p_admin_id: null })
    if (error) console.error(`[poller] void_match(${m.id}): ${error.message}`)
    else { voided++; console.log(`[poller] voided ${m.id}`) }
  }

  return { settled, voided, updated: rows.length }
}

async function pollScores() {
  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select('id, api_competition_id, api_season')
    .eq('status', 'open')
    .not('api_competition_id', 'is', null)

  if (error) { console.error(`[poller] tournaments query: ${error.message}`); return }
  if (!tournaments?.length) return

  for (let i = 0; i < tournaments.length; i++) {
    const t = tournaments[i] as { id: string; api_competition_id: string; api_season: number }
    try {
      const { settled, voided, updated } = await syncTournament(t)
      console.log(`[poller] ${t.api_competition_id}/${t.api_season}: ${updated} matches synced, settled=${settled}, voided=${voided}`)
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${err.response?.data?.message ?? err.message}`
        : String(err)
      console.error(`[poller] ${t.api_competition_id}: ${msg}`)
    }
    // Stay well under the 10 req/min free-tier limit between tournaments
    if (i < tournaments.length - 1) await sleep(7000)
  }
}

function startPoller() {
  if (!FD_API_TOKEN) {
    console.warn('[poller] FD_API_TOKEN not set — score sync disabled')
    return
  }
  const interval = Number(POLL_INTERVAL_MS)
  console.log(`[poller] starting (${interval / 1000}s interval)`)
  // First run after a short delay so the server is fully up
  setTimeout(async () => {
    await pollScores()
    setInterval(pollScores, interval)
  }, 5000)
}

// ── Types ──────────────────────────────────────────────────────────────────
interface FdCompetition {
  id: number
  name: string
  code: string
  type: string
  area: { name: string }
  currentSeason: { startDate: string; endDate: string } | null
}

interface FdMatch {
  id: number
  status: string
  utcDate: string
  homeTeam: { name?: string; shortName?: string }
  awayTeam: { name?: string; shortName?: string }
  score: {
    fullTime: { home: number | null; away: number | null }
  }
}

function normStatus(fdStatus: string): string {
  switch (fdStatus) {
    case 'SUSPENDED':  return 'POSTPONED'
    case 'ABANDONED':  return 'POSTPONED'
    case 'AWARDED':    return 'FINISHED'
    default:           return fdStatus
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(Number(PORT), () => {
  console.log(`[worker] listening on :${PORT}`)
  startPoller()
})
