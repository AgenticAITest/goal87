import { useEffect, useState } from 'react'
import { Trash2, Plus, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Navbar } from '../../components/Navbar'

interface Clip {
  id: string
  video_id: string
  label: string | null
  created_at: string
}

function extractVideoId(input: string): string | null {
  const s = input.trim()
  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const p of patterns) {
    const m = s.match(p)
    if (m) return m[1]
  }
  return null
}

export function AdminHighlights() {
  const [clips,   setClips]   = useState<Clip[]>([])
  const [url,     setUrl]     = useState('')
  const [label,   setLabel]   = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('highlight_clips')
      .select('*')
      .order('created_at', { ascending: false })
    setClips(data ?? [])
  }

  function handleUrlChange(val: string) {
    setUrl(val)
    setError(null)
    const id = extractVideoId(val)
    setPreview(id)
  }

  async function save() {
    const videoId = extractVideoId(url)
    if (!videoId) { setError('Could not extract a YouTube video ID from that URL.'); return }
    setSaving(true)
    setError(null)
    const { error: e } = await supabase
      .from('highlight_clips')
      .insert({ video_id: videoId, label: label.trim() || null })
    if (e) { setError(e.message) }
    else   { setUrl(''); setLabel(''); setPreview(null); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    await supabase.from('highlight_clips').delete().eq('id', id)
    setClips((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div className="min-h-screen bg-charcoal">
      <Navbar />
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        <div>
          <p className="text-xs text-gold uppercase tracking-[0.3em]">Admin</p>
          <h1 className="font-serif text-3xl font-bold text-white mt-1">Highlights</h1>
          <p className="text-gray-500 text-sm mt-1">
            Paste YouTube Shorts (or any YouTube) URLs below. 3 random clips are shown on the dashboard.
          </p>
        </div>

        {/* Add form */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <h2 className="text-white font-semibold">Add clip</h2>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-widest">YouTube URL or video ID</label>
              <input
                type="text"
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://www.youtube.com/shorts/abc123  or  abc123"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-gray-600"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-gray-500 uppercase tracking-widest">Label (optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Mbappe solo run vs Argentina"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-gold/50 placeholder:text-gray-600"
              />
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-4 items-start">
            <button
              onClick={save}
              disabled={!url.trim() || saving}
              className="flex items-center gap-2 bg-gold hover:bg-gold-light text-charcoal px-5 py-2.5 rounded-full font-bold text-sm transition-colors disabled:opacity-40"
            >
              <Plus size={14} />
              {saving ? 'Saving…' : 'Add clip'}
            </button>

            {preview && (
              <a
                href={`https://www.youtube.com/watch?v=${preview}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors pt-2.5"
              >
                <ExternalLink size={12} /> Verify on YouTube
              </a>
            )}
          </div>

          {/* Preview */}
          {preview && (
            <div className="pt-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Preview</p>
              <div className="relative w-40 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '9/16' }}>
                <iframe
                  src={`https://www.youtube.com/embed/${preview}?autoplay=1&mute=1&loop=1&playlist=${preview}&controls=1&rel=0`}
                  className="absolute inset-0 w-full h-full"
                  allow="autoplay; encrypted-media"
                  title="Preview"
                />
              </div>
            </div>
          )}
        </div>

        {/* Clip list */}
        {clips.length === 0 ? (
          <p className="text-gray-500 text-sm">No clips yet. Add some above.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">{clips.length} clip{clips.length !== 1 ? 's' : ''} saved</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {clips.map((c) => (
                <div key={c.id} className="relative group">
                  {/* Thumbnail */}
                  <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '9/16' }}>
                    <img
                      src={`https://img.youtube.com/vi/${c.video_id}/mqdefault.jpg`}
                      alt={c.label ?? c.video_id}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    {c.label && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
                        <p className="text-white text-[10px] font-medium truncate">{c.label}</p>
                      </div>
                    )}
                    <button
                      onClick={() => remove(c.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-red-500/80 text-white rounded-full p-1.5"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <p className="text-gray-600 text-[10px] mt-1 truncate">{c.video_id}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
