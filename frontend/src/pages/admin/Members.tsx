import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Trash2, Crown, Pencil, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'
import { useAuth } from '../../hooks/useAuth'
import { formatIDR } from '../../lib/fmt'
import type { MemberStatus, Profile } from '../../types/database'

type Filter = 'all' | MemberStatus

const STATUS_STYLES: Record<MemberStatus, string> = {
  pending:   'text-yellow-400 bg-yellow-400/10',
  active:    'text-green-400 bg-green-500/10',
  suspended: 'text-orange-400 bg-orange-400/10',
}

export function AdminMembers() {
  const { profile: self } = useAuth()
  const [members, setMembers] = useState<Profile[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]                   = useState<string | null>(null)  // id of member being acted on
  const [error, setError]                 = useState<string | null>(null)
  const [editingBalance, setEditingBalance] = useState<string | null>(null)  // member id
  const [draftBalance, setDraftBalance]   = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setMembers(data ?? [])
    setLoading(false)
  }

  async function updateStatus(id: string, newStatus: MemberStatus) {
    setBusy(id)
    setError(null)
    const { error } = await supabase.rpc('admin_update_member_status', {
      p_target_id: id,
      p_new_status: newStatus,
    })
    if (error) setError(error.message)
    else setMembers((prev) => prev.map((m) => m.id === id ? { ...m, status: newStatus } : m))
    setBusy(null)
  }

  async function deleteMember(id: string, name: string) {
    if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return
    setBusy(id)
    setError(null)
    const { error } = await supabase.rpc('admin_delete_member', { p_target_id: id })
    if (error) setError(error.message)
    else setMembers((prev) => prev.filter((m) => m.id !== id))
    setBusy(null)
  }

  function startEditBalance(member: Profile) {
    setEditingBalance(member.id)
    setDraftBalance(String(member.balance_idr))
    setError(null)
  }

  function cancelEditBalance() {
    setEditingBalance(null)
    setDraftBalance('')
  }

  async function saveBalance(member: Profile) {
    const val = parseInt(draftBalance, 10)
    if (isNaN(val) || val < 0) {
      setError('Balance must be a non-negative whole number.')
      return
    }
    setBusy(member.id)
    setError(null)
    const { error } = await supabase.rpc('admin_set_balance', {
      p_target_id: member.id,
      p_new_balance: val,
    })
    if (error) {
      setError(error.message)
    } else {
      setMembers((prev) => prev.map((m) => m.id === member.id ? { ...m, balance_idr: val } : m))
      setEditingBalance(null)
      setDraftBalance('')
    }
    setBusy(null)
  }

  async function toggleAdmin(member: Profile) {
    const action = member.is_admin ? 'remove admin from' : 'make admin'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} ${member.display_name}?`)) return
    setBusy(member.id)
    setError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ is_admin: !member.is_admin })
      .eq('id', member.id)
    if (error) setError(error.message)
    else setMembers((prev) => prev.map((m) => m.id === member.id ? { ...m, is_admin: !m.is_admin } : m))
    setBusy(null)
  }

  const visible = filter === 'all' ? members : members.filter((m) => m.status === filter)
  const counts = {
    all: members.length,
    pending:   members.filter((m) => m.status === 'pending').length,
    active:    members.filter((m) => m.status === 'active').length,
    suspended: members.filter((m) => m.status === 'suspended').length,
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all',       label: `All (${counts.all})` },
    { key: 'pending',   label: `Pending (${counts.pending})` },
    { key: 'active',    label: `Active (${counts.active})` },
    { key: 'suspended', label: `Suspended (${counts.suspended})` },
  ]

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div>
          <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
          <h1 className="font-serif text-3xl font-bold text-white mt-1">Members</h1>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          {filters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-widest font-bold transition-colors ${
                filter === key
                  ? 'bg-gold text-charcoal'
                  : 'glass text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="glass rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
        )}

        {/* Member list */}
        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm">No members in this category.</p>
        ) : (
          <div className="space-y-3">
            {visible.map((member) => (
              <div
                key={member.id}
                className="glass rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="flex items-center gap-4 min-w-0">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-sm shrink-0">
                    {member.display_name.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-white font-medium text-sm truncate">{member.display_name}</p>
                      {member.is_admin && <Crown size={12} className="text-gold shrink-0" />}
                    </div>
                    <p className="text-gray-500 text-xs truncate">{member.email}</p>

                    {/* Balance */}
                    {editingBalance === member.id ? (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-gray-500 text-xs">Rp</span>
                        <input
                          type="number"
                          min={0}
                          value={draftBalance}
                          onChange={(e) => setDraftBalance(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveBalance(member); if (e.key === 'Escape') cancelEditBalance() }}
                          className="w-36 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5 text-white text-xs focus:outline-none focus:border-gold/50"
                          autoFocus
                        />
                        <button
                          onClick={() => saveBalance(member)}
                          disabled={busy === member.id}
                          className="text-green-400 hover:text-green-300 disabled:opacity-40"
                          title="Save"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={cancelEditBalance}
                          className="text-gray-500 hover:text-gray-300"
                          title="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-gray-400 text-xs">{formatIDR(member.balance_idr)}</span>
                        <button
                          onClick={() => startEditBalance(member)}
                          className="text-gray-600 hover:text-gold transition-colors"
                          title="Set balance"
                        >
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Status badge */}
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest font-bold ${STATUS_STYLES[member.status]}`}>
                    {member.status}
                  </span>

                  {/* Actions */}
                  {member.status === 'pending' && (
                    <button
                      onClick={() => updateStatus(member.id, 'active')}
                      disabled={busy === member.id}
                      className="text-green-400 hover:text-green-300 disabled:opacity-40 transition-colors"
                      title="Approve"
                    >
                      <CheckCircle size={18} />
                    </button>
                  )}
                  {member.status === 'active' && (
                    <button
                      onClick={() => updateStatus(member.id, 'suspended')}
                      disabled={busy === member.id}
                      className="text-orange-400 hover:text-orange-300 disabled:opacity-40 transition-colors"
                      title="Suspend"
                    >
                      <XCircle size={18} />
                    </button>
                  )}
                  {member.status === 'suspended' && (
                    <button
                      onClick={() => updateStatus(member.id, 'active')}
                      disabled={busy === member.id}
                      className="text-green-400 hover:text-green-300 disabled:opacity-40 transition-colors"
                      title="Re-activate"
                    >
                      <CheckCircle size={18} />
                    </button>
                  )}
                  {self?.id !== member.id && (
                    <button
                      onClick={() => toggleAdmin(member)}
                      disabled={busy === member.id}
                      className={`disabled:opacity-40 transition-colors ${member.is_admin ? 'text-gold hover:text-gold/60' : 'text-gray-600 hover:text-gold'}`}
                      title={member.is_admin ? 'Remove admin' : 'Make admin'}
                    >
                      <Crown size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteMember(member.id, member.display_name)}
                    disabled={busy === member.id}
                    className="text-gray-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                    title="Delete permanently"
                  >
                    <Trash2 size={16} />
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
