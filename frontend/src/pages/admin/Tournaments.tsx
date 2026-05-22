import { useEffect, useState } from 'react'
import { Plus, Play, Pencil, RefreshCw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { formatIDR } from '../../lib/fmt'
import type { Tournament, TournamentStatus } from '../../types/database'

const WORKER_URL = import.meta.env.VITE_WORKER_URL ?? 'http://localhost:3001'

const STATUS_STYLES: Record<TournamentStatus, string> = {
  draft:  'text-gray-400 bg-white/5',
  open:   'text-green-400 bg-green-500/10',
  closed: 'text-orange-400 bg-orange-400/10',
}

interface TForm {
  name: string
  stake_idr: number
  start_at: string
  end_at: string
  status: TournamentStatus
}

interface FdCompetition {
  id: number
  name: string
  code: string
  area: { name: string }
  currentSeason: { startDate: string } | null
}

const EMPTY: TForm = { name: '', stake_idr: 100000, start_at: '', end_at: '', status: 'draft' }

export function AdminTournaments() {
  const [items, setItems]       = useState<Tournament[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // Create / Edit modal
  const [modal, setModal]       = useState<{ open: boolean; editing: Tournament | null }>({ open: false, editing: null })
  const [form, setForm]         = useState<TForm>(EMPTY)
  const [saving, setSaving]     = useState(false)

  // Pull Fixtures modal
  const [pullModal, setPullModal]         = useState<{ open: boolean; tournament: Tournament | null }>({ open: false, tournament: null })
  const [competitions, setCompetitions]   = useState<FdCompetition[]>([])
  const [loadingComps, setLoadingComps]   = useState(false)
  const [compSearch, setCompSearch]       = useState('')
  const [selectedComp, setSelectedComp]  = useState<FdCompetition | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number>(new Date().getFullYear())
  const [pulling, setPulling]             = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setItems(data ?? [])
    setLoading(false)
  }

  // ── Create / Edit ──────────────────────────────────────────────────────
  function openCreate() {
    setForm(EMPTY)
    setModal({ open: true, editing: null })
    setError(null)
  }

  function openEdit(t: Tournament) {
    setForm({
      name:      t.name,
      stake_idr: t.stake_idr,
      start_at:  t.start_at ? t.start_at.slice(0, 10) : '',
      end_at:    t.end_at   ? t.end_at.slice(0, 10)   : '',
      status:    t.status,
    })
    setModal({ open: true, editing: t })
    setError(null)
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    const payload = {
      name:      form.name.trim(),
      stake_idr: Number(form.stake_idr),
      start_at:  form.start_at || null,
      end_at:    form.end_at   || null,
      status:    form.status,
    }
    let err
    if (modal.editing) {
      ;({ error: err } = await supabase.from('tournaments').update(payload).eq('id', modal.editing.id))
    } else {
      ;({ error: err } = await supabase.from('tournaments').insert(payload))
    }
    if (err) setError(err.message)
    else { setModal({ open: false, editing: null }); await load() }
    setSaving(false)
  }

  // ── Pull Fixtures ──────────────────────────────────────────────────────
  async function openPullModal(t: Tournament) {
    setPullModal({ open: true, tournament: t })
    setSelectedComp(null)
    setSelectedSeason(new Date().getFullYear())
    setCompSearch('')
    setError(null)

    // If we already have competitions cached, skip fetch
    if (competitions.length > 0) return

    setLoadingComps(true)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch(`${WORKER_URL}/competitions`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const json = await res.json() as FdCompetition[] | { error: string }
      if (!res.ok) setError((json as { error: string }).error ?? 'Failed to load competitions')
      else setCompetitions(json as FdCompetition[])
    } catch (e) {
      setError(String(e))
    }
    setLoadingComps(false)
  }

  function selectComp(c: FdCompetition) {
    setSelectedComp(c)
    // Auto-fill season from competition's current season start year
    if (c.currentSeason?.startDate) {
      setSelectedSeason(Number(c.currentSeason.startDate.slice(0, 4)))
    }
  }

  async function confirmPull() {
    if (!selectedComp || !selectedSeason || !pullModal.tournament) return
    const t = pullModal.tournament

    setPulling(true)
    setError(null)

    // Persist the linked competition on the tournament record
    await supabase.from('tournaments').update({
      api_competition_id: selectedComp.code,
      api_season:         selectedSeason,
    }).eq('id', t.id)

    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch(`${WORKER_URL}/pull-fixtures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ competition_code: selectedComp.code, season: selectedSeason, tournament_id: t.id }),
      })
      const json = await res.json() as { total?: number; error?: string }
      if (!res.ok) setError(json.error ?? 'Pull failed')
      else setError(`✓ ${json.total} fixtures pulled for ${t.name}`)
    } catch (e) {
      setError(String(e))
    }

    await load()
    setPullModal({ open: false, tournament: null })
    setPulling(false)
  }

  const filteredComps = competitions.filter(c =>
    `${c.name} ${c.area.name}`.toLowerCase().includes(compSearch.toLowerCase()),
  )

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
            <h1 className="font-serif text-3xl font-bold text-white mt-1">Tournaments</h1>
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 bg-gold hover:bg-gold-light text-charcoal px-5 py-2.5 rounded-full font-bold text-sm tracking-wide transition-colors">
            <Plus size={16} /> New Tournament
          </button>
        </div>

        {error && (
          <div className={`glass rounded-xl px-4 py-3 text-sm ${error.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{error}</div>
        )}

        {loading ? <p className="text-gray-500 text-sm">Loading…</p> : items.length === 0 ? (
          <p className="text-gray-500 text-sm">No tournaments yet.</p>
        ) : (
          <div className="space-y-3">
            {items.map((t) => (
              <div key={t.id} className="glass rounded-2xl px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-white font-semibold">{t.name}</h2>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest font-bold ${STATUS_STYLES[t.status]}`}>{t.status}</span>
                    </div>
                    <p className="text-gray-400 text-sm">
                      {t.api_competition_id
                        ? <>{t.api_competition_id} · {t.api_season} · </>
                        : <span className="text-yellow-500/80 text-xs">No competition linked · </span>}
                      {formatIDR(t.stake_idr)}/match
                    </p>
                    {(t.start_at || t.end_at) && (
                      <p className="text-gray-500 text-xs">{t.start_at?.slice(0, 10)} → {t.end_at?.slice(0, 10)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <button onClick={() => openEdit(t)} className="glass px-3 py-1.5 rounded-full text-xs text-gray-300 hover:text-white flex items-center gap-1.5 transition-colors">
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => openPullModal(t)}
                      className="glass px-3 py-1.5 rounded-full text-xs text-gold hover:text-gold-light flex items-center gap-1.5 transition-colors"
                    >
                      <Play size={12} /> Pull Fixtures
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create / Edit modal ─────────────────────────────────────────── */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="glass rounded-2xl p-6 w-full max-w-md space-y-4">
            <h2 className="font-serif text-xl font-bold text-white">
              {modal.editing ? 'Edit Tournament' : 'New Tournament'}
            </h2>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {([
              { label: 'Name',                key: 'name',      type: 'text',   placeholder: 'e.g. Premier League 25/26' },
              { label: 'Stake per match (IDR)', key: 'stake_idr', type: 'number', placeholder: '100000' },
              { label: 'Start date',           key: 'start_at',  type: 'date',   placeholder: '' },
              { label: 'End date',             key: 'end_at',    type: 'date',   placeholder: '' },
            ] as const).map(({ label, key, type, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-gray-400 uppercase tracking-widest">{label}</label>
                <input
                  type={type}
                  value={String(form[key as keyof TForm])}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
                />
              </div>
            ))}

            <div className="space-y-1">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TournamentStatus }))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
              >
                <option value="draft">Draft</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal({ open: false, editing: null })} className="flex-1 glass py-2.5 rounded-full text-sm text-gray-300 hover:text-white transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-gold hover:bg-gold-light disabled:opacity-50 text-charcoal py-2.5 rounded-full text-sm font-bold transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pull Fixtures modal ─────────────────────────────────────────── */}
      {pullModal.open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="glass rounded-2xl p-6 w-full max-w-md space-y-4">
            <div>
              <h2 className="font-serif text-xl font-bold text-white">Pull Fixtures</h2>
              <p className="text-gray-400 text-sm mt-1">for <span className="text-white">{pullModal.tournament?.name}</span></p>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            {/* Competition picker */}
            <div className="space-y-2">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Competition</label>

              {loadingComps ? (
                <p className="text-gray-500 text-sm py-2">Loading competitions…</p>
              ) : (
                <>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Search by name or country…"
                      value={compSearch}
                      onChange={(e) => setCompSearch(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
                    />
                  </div>

                  <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl">
                    {filteredComps.length === 0 ? (
                      <p className="text-gray-500 text-sm py-2 px-1">No competitions found.</p>
                    ) : filteredComps.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectComp(c)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between gap-2 ${
                          selectedComp?.code === c.code
                            ? 'bg-gold/20 text-gold'
                            : 'hover:bg-white/5 text-gray-300'
                        }`}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-gray-500 shrink-0">{c.area.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Season */}
            {selectedComp && (
              <div className="space-y-1">
                <label className="text-xs text-gray-400 uppercase tracking-widest">Season (start year)</label>
                <input
                  type="number"
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(Number(e.target.value))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 transition-colors"
                />
                <p className="text-gray-500 text-xs">Auto-filled from current season. Change only for historical data.</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setPullModal({ open: false, tournament: null })} className="flex-1 glass py-2.5 rounded-full text-sm text-gray-300 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={confirmPull}
                disabled={!selectedComp || pulling}
                className="flex-1 bg-gold hover:bg-gold-light disabled:opacity-40 text-charcoal py-2.5 rounded-full text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                {pulling ? <><RefreshCw size={14} className="animate-spin" /> Pulling…</> : 'Pull Fixtures'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
