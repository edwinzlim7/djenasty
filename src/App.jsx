import { useState, useEffect, useRef } from 'react'
import {
  getPlaylist, savePlaylist,
  getAllRatings, upsertRating, deleteRating, deleteAllRatings,
  getRatingHistory, saveHistorySnapshot,
  getPatchNotes, addPatchNote, deletePatchNote, updatePatchNote,
  getRoadmap, addRoadmapItems, toggleRoadmapItem, deleteRoadmapItem,
  subscribeToRatings, subscribeToPlaylist,
} from './db.js'

// ─── Config ────────────────────────────────────────────────────────────────
const DJ_PASSWORD = import.meta.env.VITE_DJ_PASSWORD || 'GOATED'

// ─── CSV parser ────────────────────────────────────────────────────────────
function splitCSVLine(line) {
  // Properly handles quoted fields containing commas
  const cols = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
    else { current += ch }
  }
  cols.push(current.trim())
  return cols
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (!lines.length) return []

  // Always read the header row to find columns by name — never guess by index
  const headerCols = splitCSVLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, '').trim())
  const hasHeader = headerCols.some(h =>
    h.includes('title') || h.includes('track') || h.includes('artist') || h.includes('name')
  )

  // Find column indices from header names (works for Exportify and any other CSV)
  // Exportify headers include: "Track Name", "Artist Name(s)", "Album Image URL"
  // We look for the most specific match first
  const findCol = (...terms) => {
    for (const term of terms) {
      const idx = headerCols.findIndex(h => h.includes(term))
      if (idx !== -1) return idx
    }
    return -1
  }

  let titleIdx  = hasHeader ? findCol('track name', 'title', 'track', 'name') : -1
  let artistIdx = hasHeader ? findCol('artist name', 'artist') : -1
  let artIdx    = hasHeader ? findCol('album image', 'image url', 'artwork', 'cover') : -1

  // Fallback indices if header not found
  if (titleIdx  === -1) titleIdx  = 0
  if (artistIdx === -1) artistIdx = 1

  const dataLines = hasHeader ? lines.slice(1) : lines
  const tracks = []

  for (const line of dataLines) {
    if (!line.trim()) continue
    const cols = splitCSVLine(line)
    if (!cols.length) continue

    let title    = (cols[titleIdx]  || '').trim()
    let artist   = (cols[artistIdx] || '').trim()
    let albumArt = artIdx >= 0 ? (cols[artIdx] || '').trim() : ''

    // Strip Spotify URIs (e.g. "spotify:artist:abc123") — use empty string instead
    if (artist.startsWith('spotify:')) artist = ''
    if (albumArt.startsWith('spotify:')) albumArt = ''

    // Single-column fallback: "Artist - Title"
    if (!title && cols.length === 1) {
      const dash = cols[0].indexOf(' - ')
      if (dash > -1) { artist = cols[0].slice(0, dash); title = cols[0].slice(dash + 3) }
      else title = cols[0]
    }

    if (title) tracks.push({ id: `${artist}::${title}`, title, artist, albumArt })
  }

  return tracks
}

// ─── Rating config ─────────────────────────────────────────────────────────
const RAINBOW = 'linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#c77dff)'
const RATINGS = [
  { key: 'rainbow', label: 'ELITE',  color: '#c77dff', bg: 'transparent', border: 'transparent', emoji: '🌈', score: 4, isRainbow: true },
  { key: 'green',   label: 'Fire',    color: '#6bcb77', bg: '#6bcb7718', border: '#6bcb7740', emoji: '🟢', score: 3 },
  { key: 'yellow',  label: 'Solid',   color: '#ffd93d', bg: '#ffd93d18', border: '#ffd93d40', emoji: '🟡', score: 2 },
  { key: 'red',     label: 'Drop it', color: '#ff6b6b', bg: '#ff6b6b18', border: '#ff6b6b40', emoji: '🔴', score: 0 },
]
const getRating = key => RATINGS.find(r => r.key === key) || null

function calcVerdict(allRatings) {
  const votes = Object.values(allRatings).filter(Boolean)
  if (!votes.length) return null
  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 }
  votes.forEach(v => { if (c[v] !== undefined) c[v]++ })
  if (c.rainbow > 0) return 'rainbow'
  // Score: green=1.0, yellow=0.67, red=0.0
  // Thresholds: green needs majority green votes, yellow is middle ground
  const score = (c.green * 3 + c.yellow * 2) / (votes.length * 3)
  if (score >= 0.8) return 'green'
  if (score >= 0.4) return 'yellow'
  return 'red'
}

// ─── Analytics helpers ─────────────────────────────────────────────────────
function buildAnalytics(transitions, ratings, ratingHistory) {
  // Per-transition stats
  const stats = transitions.map(t => {
    const votes = Object.values(t.allRatings).filter(Boolean)
    const c = { green: 0, yellow: 0, red: 0, rainbow: 0 }
    votes.forEach(v => { if (c[v] !== undefined) c[v]++ })
    const total = votes.length
    const score = total ? (c.green * 3 + c.yellow * 2 + c.rainbow * 4) / (total * 4) : null
    return { ...t, counts: c, total, score, verdict: calcVerdict(t.allRatings) }
  })

  // Overall totals
  const allVotes = Object.values(ratings).flatMap(r => Object.values(r)).filter(Boolean)
  const totalVotes = allVotes.length
  const totalVoters = new Set(
    Object.values(ratings).flatMap(r => Object.keys(r))
  ).size
  const globalCounts = { green: 0, yellow: 0, red: 0, rainbow: 0 }
  allVotes.forEach(v => { if (globalCounts[v] !== undefined) globalCounts[v]++ })

  // Sorted best/worst (min 1 vote)
  const voted = stats.filter(s => s.total > 0)
  const best  = [...voted].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5)
  const worst = [...voted].sort((a, b) => (a.score ?? 99) - (b.score ?? 99)).slice(0, 5)
  const elites = voted.filter(s => s.counts.rainbow > 0).sort((a, b) => b.counts.rainbow - a.counts.rainbow)

  // Participation per transition
  const avgVotesPerTransition = voted.length ? (voted.reduce((sum, s) => sum + s.total, 0) / voted.length).toFixed(1) : 0

  return { stats, totalVotes, totalVoters, globalCounts, best, worst, elites, avgVotesPerTransition, voted }
}

// ─── Small UI components ────────────────────────────────────────────────────
function NewBadge() {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: '2px 6px',
      borderRadius: 4, background: '#00d2d322', color: '#00d2d3',
      border: '1px solid #00d2d355', flexShrink: 0, verticalAlign: 'middle',
    }}>NEW</span>
  )
}

// ─── Vote animation — radial particle burst + label flash ─────────────────
function VoteAnimation({ voteKey, onDone }) {
  const r = getRating(voteKey)
  if (!r) return null

  // 8 particles evenly around a circle, each travels outward at its angle
  const count = 8
  const particles = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 360
    const rad   = (angle * Math.PI) / 180
    const dist  = 28 + Math.random() * 10
    return {
      dx: Math.cos(rad) * dist,
      dy: Math.sin(rad) * dist,
      delay: i * 0.018,
      size: 4 + Math.random() * 3,
    }
  })

  const color   = r.isRainbow ? '#c77dff' : r.color
  const colors  = r.isRainbow
    ? ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff']
    : [color, color + 'cc', color + '88']

  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none', zIndex: 200, width: 0, height: 0,
    }}>
      {/* Ring burst particles */}
      {particles.map((p, i) => (
        <div
          key={i}
          onAnimationEnd={i === 0 ? onDone : undefined}
          style={{
            position: 'absolute',
            width: p.size, height: p.size,
            borderRadius: '50%',
            background: colors[i % colors.length],
            top: 0, left: 0,
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
            animation: `voteBurst 0.55s cubic-bezier(.15,.6,.3,1) ${p.delay}s both`,
            boxShadow: `0 0 ${p.size * 2}px ${colors[i % colors.length]}`,
          }}
        />
      ))}
      {/* Central flash ring */}
      <div style={{
        position: 'absolute',
        width: 42, height: 42,
        borderRadius: '50%',
        top: -21, left: -21,
        border: `2px solid ${color}`,
        animation: 'voteRing 0.45s cubic-bezier(.2,.8,.3,1) both',
        boxShadow: `0 0 12px ${color}66`,
      }} />
      {/* Label flash */}
      <div style={{
        position: 'absolute',
        top: -52, left: '50%', transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
        fontSize: 9, fontWeight: 800, letterSpacing: 2.5,
        color: color,
        fontFamily: "'Inconsolata',monospace",
        animation: 'voteLabelFade 0.6s ease-out 0.05s both',
        textShadow: `0 0 12px ${color}`,
      }}>
        {r.label.toUpperCase()}
      </div>
    </div>
  )
}

function ExpandingRater({ myVote, onVote }) {
  const [open, setOpen] = useState(false)
  const [animatingKey, setAnimatingKey] = useState(null)
  const containerRef = useRef(null)
  const active = myVote ? getRating(myVote) : null

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
    }
  }, [open])

  const handlePick = (key) => {
    // Only called for non-active buttons — always a fresh vote
    setAnimatingKey(key)
    onVote(key)
    setOpen(false)
  }

  const handleRemove = (e) => {
    // Dedicated remove handler — stops propagation so it never reaches the vote button
    e.stopPropagation()
    onVote(null)
    setOpen(false)
  }

  const clearAnimation = () => setAnimatingKey(null)

  return (
    <div ref={containerRef} style={{ position: 'relative', flexShrink: 0 }}>

      {/* ── Trigger button ── */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(o => !o)}
          title={active ? `Your vote: ${active.label} — tap to change` : 'Tap to rate'}
          style={{
            width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: active ? (active.isRainbow ? RAINBOW : active.color) : '#1e1c2a',
            boxShadow: active
              ? (active.isRainbow ? '0 0 20px 6px #c77dff44' : `0 0 18px 6px ${active.color}66`)
              : 'inset 0 2px 8px #00000099, 0 0 0 1px #2a2838',
            transition: 'all 0.2s cubic-bezier(.4,2,.5,1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: open ? 'scale(1.08)' : 'scale(1)',
          }}
        >
          {active
            ? <span style={{ fontSize: 17 }}>{active.emoji}</span>
            : <span style={{ opacity: 0.4, fontSize: 18 }}>☆</span>
          }
        </button>
        {/* Vote animation fires from the trigger button position */}
        {animatingKey && (
          <VoteAnimation voteKey={animatingKey} onDone={clearAnimation} />
        )}
      </div>

      {/* ── Expanded panel ── */}
      {open && (
        <div style={{
          position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'stretch',
          zIndex: 100,
          background: '#1a1828',
          borderRadius: 16,
          border: '1.5px solid #5a54a0',
          boxShadow: '0 16px 56px #000000dd, 0 0 0 1px #ffffff10',
          padding: '10px 8px',
          minWidth: 148,
          animation: 'fanIn .15s ease-out',
        }}>

          {/* Header */}
          <div style={{ fontSize: 10, letterSpacing: 3, fontWeight: 700, color: '#b8b0f0', textAlign: 'center', padding: '0 4px 8px', borderBottom: '1.5px solid #3a3560' }}>
            RATE THIS MIX
          </div>

          {/* Rating rows */}
          {RATINGS.map(rv => {
            const isActive = myVote === rv.key
            return (
              <div key={rv.key} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px', borderRadius: 10, cursor: 'pointer',
                background: isActive ? (rv.isRainbow ? 'rgba(199,125,255,0.15)' : `${rv.color}22`) : '#22203a',
                border: isActive ? `1.5px solid ${rv.isRainbow ? '#c77dff88' : rv.color + '88'}` : '1.5px solid transparent',
                transition: 'all 0.15s ease',
                marginTop: 2,
              }}>
                {/* Vote button — only fires for non-active */}
                <button
                  onClick={() => !isActive && handlePick(rv.key)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none',
                    cursor: isActive ? 'default' : 'pointer',
                    background: isActive ? (rv.isRainbow ? RAINBOW : rv.color) : '#2e2c4a',
                    boxShadow: isActive
                      ? (rv.isRainbow ? '0 0 12px 4px #c77dff66' : `0 0 12px 4px ${rv.color}66`)
                      : 'inset 0 2px 4px #00000099',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ opacity: isActive ? 1 : 0.7 }}>{rv.emoji}</span>
                </button>

                {/* Label */}
                <span style={{
                  flex: 1,
                  fontSize: 12, fontWeight: isActive ? 800 : 600,
                  color: isActive ? (rv.isRainbow ? '#e0c8ff' : rv.color) : '#c0bcd8',
                  letterSpacing: 0.5,
                }}>
                  {rv.label}
                </span>

                {/* Remove button — completely separate from vote button */}
                {isActive && (
                  <button
                    onClick={handleRemove}
                    title="Remove your vote"
                    style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: '#3a3660', border: '1.5px solid #6a64a0',
                      color: '#c0bcd8', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, lineHeight: 1,
                      transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#ff6b6b44'; e.currentTarget.style.color = '#ff6b6b'; e.currentTarget.style.borderColor = '#ff6b6b88' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#3a3660'; e.currentTarget.style.color = '#c0bcd8'; e.currentTarget.style.borderColor = '#6a64a0' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}

          {/* Footer */}
          <div style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 600, color: '#9490c8', textAlign: 'center', padding: '8px 4px 2px', borderTop: '1.5px solid #3a3560' }}>
            {myVote ? 'TAP ✕ TO REMOVE VOTE' : 'TAP A RATING ABOVE'}
          </div>
        </div>
      )}
    </div>
  )
}

function VerdictChip({ allRatings }) {
  const votes = Object.values(allRatings).filter(Boolean)
  if (!votes.length) return <span style={{ color: '#55526a', fontSize: 11, fontStyle: 'italic' }}>no votes yet</span>
  const v = calcVerdict(allRatings)
  const r = getRating(v)
  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 }
  votes.forEach(x => { if (c[x] !== undefined) c[x]++ })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {r.isRainbow ? (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, padding: '3px 10px', borderRadius: 5, background: RAINBOW, color: '#000' }}>ELITE</span>
      ) : (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, padding: '3px 10px', borderRadius: 5, color: r.color, background: r.bg, border: `1px solid ${r.border}` }}>
          {r.label.toUpperCase()}
        </span>
      )}
      <span style={{ fontSize: 11, display: 'flex', gap: 5 }}>
        {c.rainbow > 0 && <span title="Elite">🌈{c.rainbow}</span>}
        {c.green > 0 && <span style={{ color: '#6bcb77' }}>●{c.green}</span>}
        {c.yellow > 0 && <span style={{ color: '#ffd93d' }}>●{c.yellow}</span>}
        {c.red > 0 && <span style={{ color: '#ff6b6b' }}>●{c.red}</span>}
      </span>
    </div>
  )
}

// Mini bar for analytics
function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: '#16151f', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 10, color: '#444', width: 28, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

const TABS = ['RATE', 'ANALYTICS', 'PATCH NOTES', 'ROADMAP']

// ─── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [booted, setBooted]           = useState(false)
  const [bootError, setBootError]     = useState('')
  const [tab, setTab]                 = useState('RATE')
  const [tracks, setTracks]           = useState([])
  const [currentVersion, setVersion]  = useState(1)
  const [newTrackIds, setNewTrackIds] = useState(new Set())
  const [ratings, setRatings]         = useState({})
  const [ratingHistory, setHistory]   = useState({})
  const [patchNotes, setPatchNotes]   = useState([])
  const [roadmap, setRoadmap]         = useState([])

  const [userName, setUserName]       = useState(() => localStorage.getItem('djenasty-name') || '')
  const [nameInput, setNameInput]     = useState('')
  const [showNameModal, setNameModal] = useState(false)

  const [djMode, setDjMode]           = useState(false)
  const [showDjLogin, setDjLogin]     = useState(false)
  const [djPwInput, setDjPwInput]     = useState('')
  const [djError, setDjError]         = useState('')

  const [csvText, setCsvText]         = useState('')
  const [csvError, setCsvError]       = useState('')
  const [importMsg, setImportMsg]     = useState('')
  const [importing, setImporting]     = useState(false)

  const [editingPatch, setEditPatch]  = useState(false)
  const [editingRoad, setEditRoad]    = useState(false)
  const [patchDraft, setPatchDraft]   = useState('')
  const [editingNoteId, setEditingNoteId] = useState(null)  // id of note being edited
  const [editNoteDraft, setEditNoteDraft] = useState('')
  const [roadDraft, setRoadDraft]     = useState('')

  const fileRef = useRef()

  // ── Boot: load everything from Supabase ───────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [pl, allR, hist, pn, rm] = await Promise.all([
          getPlaylist(),
          getAllRatings(),
          getRatingHistory(),
          getPatchNotes(),
          getRoadmap(),
        ])

        if (pl) {
          setTracks(pl.tracks || [])
          setVersion(pl.version || 1)
          // Restore new_track_ids from DB so NEW badges survive refresh
          setNewTrackIds(new Set(pl.new_track_ids || []))
        }
        setRatings(allR)
        setHistory(hist)
        setPatchNotes(pn)
        setRoadmap(rm)
      } catch (err) {
        setBootError('Could not connect to Supabase. Check your .env credentials.')
        console.error('Boot error:', err)
      }
      setBooted(true)
    })()
  }, [])

  // ── Realtime: live rating updates ─────────────────────────────────────────
  useEffect(() => {
    if (!booted) return
    const unsubRatings = subscribeToRatings({
      onInsert: row => setRatings(prev => ({
        ...prev,
        [row.transition_key]: { ...(prev[row.transition_key] || {}), [row.user_name]: row.rating },
      })),
      onUpdate: row => setRatings(prev => ({
        ...prev,
        [row.transition_key]: { ...(prev[row.transition_key] || {}), [row.user_name]: row.rating },
      })),
      onDelete: row => setRatings(prev => {
        // Only called when REPLICA IDENTITY FULL is set and full row data is available
        const block = { ...(prev[row.transition_key] || {}) }
        delete block[row.user_name]
        return { ...prev, [row.transition_key]: block }
      }),
      onRefreshNeeded: async () => {
        // Fallback when DELETE payload doesn't include row data — reload from DB
        const fresh = await getAllRatings()
        setRatings(fresh)
      },
    })

    // Also listen for playlist changes (e.g. DJ updates on another device)
    const unsubPlaylist = subscribeToPlaylist({
      onChange: pl => {
        if (pl) {
          setTracks(pl.tracks || [])
          setVersion(pl.version || 1)
          setNewTrackIds(new Set(pl.new_track_ids || []))
        }
      },
    })

    return () => { unsubRatings(); unsubPlaylist() }
  }, [booted])

  // ── Persist user name locally ─────────────────────────────────────────────
  useEffect(() => {
    if (userName) localStorage.setItem('djenasty-name', userName)
  }, [userName])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const tKey = (i) => `${tracks[i]?.id}|||${tracks[i + 1]?.id}`

  const transitions = tracks.slice(0, -1).map((_, i) => {
    const key = tKey(i)
    return {
      index: i, from: tracks[i], to: tracks[i + 1], key,
      allRatings: ratings[key] || {},
      myVote: userName ? (ratings[key] || {})[userName] || null : null,
      isNew: newTrackIds.has(tracks[i]?.id) || newTrackIds.has(tracks[i + 1]?.id),
      history: ratingHistory[key] || {},
    }
  })

  // ── Vote ──────────────────────────────────────────────────────────────────
  const handleVote = async (idx, voteKey) => {
    if (!userName) { setNameModal(true); return }
    const key = tKey(idx)
    const current = (ratings[key] || {})[userName]
    const isRemove = voteKey === null || current === voteKey

    // Optimistically update local state immediately so UI feels instant
    setRatings(prev => {
      const block = { ...(prev[key] || {}) }
      if (isRemove) {
        delete block[userName]
      } else {
        block[userName] = voteKey
      }
      return { ...prev, [key]: block }
    })

    try {
      if (isRemove) {
        await deleteRating(key, userName)
      } else {
        await upsertRating(key, userName, voteKey)
      }
      // Realtime will also fire and keep other users in sync
    } catch (err) {
      console.error('Vote failed:', err)
      // Revert optimistic update on error by reloading from DB
      const fresh = await getAllRatings()
      setRatings(fresh)
    }
  }

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    setCsvError(''); setImportMsg(''); setImporting(true)
    try {
      const parsed = parseCSV(csvText)
      if (parsed.length < 2) { setCsvError('Need at least 2 tracks. Check format.'); setImporting(false); return }

      const oldIds = new Set(tracks.map(t => t.id))
      const addedIds = parsed.map(t => t.id).filter(id => !oldIds.has(id))
      const newVersion = currentVersion + 1

      // 1. Snapshot current ratings into history BEFORE changing anything
      await saveHistorySnapshot(ratings, currentVersion)

      // 2. Build new tracks array, preserving addedIn version for existing tracks
      const newTracks = parsed.map(t => ({
        ...t,
        albumArt: t.albumArt || tracks.find(o => o.id === t.id)?.albumArt || '',
        addedIn: addedIds.includes(t.id) ? newVersion : (tracks.find(o => o.id === t.id)?.addedIn || 1),
      }))

      // 3. Persist playlist WITH new_track_ids to Supabase
      //    This is the key fix: new_track_ids is saved to DB, not just memory
      await savePlaylist(newTracks, newVersion, addedIds)

      // 4. Update local state
      setTracks(newTracks)
      setNewTrackIds(new Set(addedIds))
      setVersion(newVersion)
      setHistory(await getRatingHistory())

      setCsvText('')
      setImportMsg(`✓ ${parsed.length} tracks · ${addedIds.length} new · now at v${newVersion}`)
      setTimeout(() => setImportMsg(''), 8000)
    } catch (err) {
      setCsvError(`Import failed: ${err.message}`)
    }
    setImporting(false)
  }

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCsvText(ev.target.result)
    reader.readAsText(file); e.target.value = ''
  }

  // ── Patch notes ───────────────────────────────────────────────────────────
  const savePatch = async () => {
    const lines = patchDraft.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return
    const noteDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    await addPatchNote(currentVersion, noteDate, lines)
    setPatchNotes(await getPatchNotes())
    setEditPatch(false); setPatchDraft('')
  }
  const handleDeletePatch = async (id) => {
    await deletePatchNote(id); setPatchNotes(await getPatchNotes())
  }
  const startEditNote = (note) => {
    setEditingNoteId(note.id)
    setEditNoteDraft((note.notes || []).join('\n'))
  }
  const cancelEditNote = () => {
    setEditingNoteId(null); setEditNoteDraft('')
  }
  const saveEditedPatch = async (id) => {
    const lines = editNoteDraft.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return
    await updatePatchNote(id, lines)
    setPatchNotes(await getPatchNotes())
    setEditingNoteId(null); setEditNoteDraft('')
  }

  // ── Roadmap ───────────────────────────────────────────────────────────────
  const saveRoad = async () => {
    const items = roadDraft.split('\n')
      .map((text, i) => ({ text: text.trim(), sort_order: i, done: false }))
      .filter(x => x.text)
    if (!items.length) return
    await addRoadmapItems(items)
    setRoadmap(await getRoadmap())
    setEditRoad(false); setRoadDraft('')
  }
  const handleToggleRoad = async (id, done) => {
    await toggleRoadmapItem(id, done); setRoadmap(await getRoadmap())
  }
  const handleDeleteRoad = async (id) => {
    await deleteRoadmapItem(id); setRoadmap(await getRoadmap())
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  const analytics = buildAnalytics(transitions, ratings, ratingHistory)

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    page: {
      minHeight: '100vh', background: '#07070b', color: '#ccc8d8',
      fontFamily: "'Inconsolata','Courier New',monospace",
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '0 16px 100px',
      backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% 0%, #0d0b1a 0%, transparent 100%)',
    },
    card: (extra = {}) => ({
      background: '#0c0b12', border: '1px solid #16151f',
      borderRadius: 14, padding: '20px 18px',
      width: '100%', maxWidth: 560, ...extra,
    }),
    inp: {
      background: '#08080f', border: '1.5px solid #18172a',
      borderRadius: 9, color: '#ccc8d8',
      fontFamily: "'Inconsolata',monospace", fontSize: 13,
      padding: '11px 13px', width: '100%', outline: 'none',
      boxSizing: 'border-box', transition: 'border-color .2s',
    },
    btn: (bg = '#6bcb77', fg = '#000', extra = {}) => ({
      background: bg, color: fg, fontFamily: "'Inconsolata',monospace",
      fontWeight: 700, fontSize: 11, letterSpacing: 1.5,
      border: 'none', borderRadius: 9, padding: '11px 18px',
      cursor: 'pointer', transition: 'opacity .15s, transform .12s', ...extra,
    }),
    sectionLabel: { fontSize: 9, letterSpacing: 4, color: '#6bcb77', marginBottom: 14, fontWeight: 700, display: 'block' },
    dimLabel: { fontSize: 9, letterSpacing: 3, color: '#55526a', marginBottom: 2, display: 'block' },
  }

  // ── Boot / error states ────────────────────────────────────────────────────
  if (!booted) return (
    <div style={{ ...S.page, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: '#222', fontSize: 12, letterSpacing: 4 }}>CONNECTING TO SUPABASE...</div>
    </div>
  )

  if (bootError) return (
    <div style={{ ...S.page, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ ...S.card({ maxWidth: 400, textAlign: 'center' }) }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>⚠️</div>
        <div style={{ color: '#ff6b6b', fontSize: 13, lineHeight: 1.8 }}>{bootError}</div>
        <div style={{ color: '#333', fontSize: 11, marginTop: 12 }}>Check your .env file and make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set correctly.</div>
      </div>
    </div>
  )

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;700;900&family=Playfair+Display:wght@700;900&display=swap');
        * { box-sizing: border-box; }
        input:focus, textarea:focus { border-color: #6bcb7766 !important; outline: none; }
        .tc { transition: border-color .3s, background .25s; }
        .tc:hover { background: #0f0e18 !important; }
        button:active { transform: scale(.94) !important; }
        textarea { resize: vertical; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1e1d2a; }
        @keyframes fanIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes voteBurst {
          0%   { opacity: 1; transform: translate(0, 0) scale(1); }
          70%  { opacity: 1; transform: translate(var(--dx), var(--dy)) scale(1.1); }
          100% { opacity: 0; transform: translate(calc(var(--dx) * 1.3), calc(var(--dy) * 1.3)) scale(0); }
        }
        @keyframes voteRing {
          0%   { opacity: 0.9; transform: scale(0.6); }
          60%  { opacity: 0.5; transform: scale(1.5); }
          100% { opacity: 0;   transform: scale(1.9); }
        }
        @keyframes voteLabelFade {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px); }
          25%  { opacity: 1; transform: translateX(-50%) translateY(0); }
          75%  { opacity: 1; transform: translateX(-50%) translateY(-4px); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }
        @keyframes flowDot {
          0%   { opacity: 0.15; transform: translateX(-6px); }
          50%  { opacity: 1;    transform: translateX(0px);  }
          100% { opacity: 0.15; transform: translateX(6px);  }
        }
        @keyframes flowDot2 {
          0%   { opacity: 0.15; transform: translateX(-6px); }
          50%  { opacity: 1;    transform: translateX(0px);  }
          100% { opacity: 0.15; transform: translateX(6px);  }
        }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ width: '100%', maxWidth: 560, padding: '34px 0 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 6, color: '#22202e', marginBottom: 5 }}>DJ TOOLKIT</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 34, letterSpacing: -1, lineHeight: 1, color: '#e8e4f0' }}>
            DJ<span style={{ background: RAINBOW, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>eNasty</span>
          </div>
          {tracks.length > 0 && (
            <div style={{ fontSize: 10, color: '#7870a8', marginTop: 5, letterSpacing: 2 }}>
              VERSION {currentVersion} · {tracks.length} TRACKS · {transitions.length} TRANSITIONS
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!djMode
            ? <button onClick={() => { setDjLogin(true); setDjError(''); setDjPwInput('') }} style={{ ...S.btn('#16151f', '#555'), fontSize: 10, padding: '8px 13px' }}>DJ LOGIN</button>
            : <button onClick={() => setDjMode(false)} style={{ ...S.btn('#6bcb77', '#000'), fontSize: 10, padding: '8px 13px' }}>✦ DJ MODE</button>
          }
        </div>
      </div>

      {/* ── SPOTIFY EMBED ── */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 20 }}>
        <iframe
          style={{ borderRadius: 12 }}
          src="https://open.spotify.com/embed/playlist/1J28GW1w0BfpTBV3vpLQls?utm_source=generator&theme=0"
          width="100%"
          height="352"
          frameBorder="0"
          allowFullScreen
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      </div>

      {/* ── NAME PILL ── */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
        {userName ? (
          <>
            <span style={{ background: '#6bcb7718', border: '1px solid #6bcb7740', borderRadius: 20, padding: '4px 13px', fontSize: 11, color: '#6bcb77' }}>
              👤 {userName}
            </span>
            <button onClick={() => { setNameInput(userName); setNameModal(true) }}
              style={{ background: '#1e1c2a', border: '1px solid #3a3560', color: '#9490aa', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 20, padding: '4px 11px', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2a2840'; e.currentTarget.style.color = '#c8c4d8' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1e1c2a'; e.currentTarget.style.color = '#9490aa' }}
            >change</button>
          </>
        ) : (
          <button onClick={() => setNameModal(true)} style={{ ...S.btn('#16151f', '#555'), fontSize: 10, padding: '7px 13px' }}>
            SET NAME TO VOTE
          </button>
        )}
      </div>

      {/* ── TABS ── */}
      <div style={{ width: '100%', maxWidth: 560, display: 'flex', borderBottom: '1px solid #16151f', marginBottom: 22, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', fontFamily: "'Inconsolata',monospace",
            fontSize: 10, letterSpacing: 2, padding: '10px 14px', cursor: 'pointer',
            color: tab === t ? '#6bcb77' : '#2e2c3e',
            borderBottom: `2px solid ${tab === t ? '#6bcb77' : 'transparent'}`,
            marginBottom: -1, transition: 'color .15s', whiteSpace: 'nowrap',
          }}>{t}</button>
        ))}
      </div>

      {/* ══════════════════════════════ TAB: RATE ══════════════════════════════ */}
      {tab === 'RATE' && (
        <div style={{ width: '100%', maxWidth: 560 }}>

          {/* DJ Import Panel */}
          {djMode && (
            <div style={{ ...S.card({ border: '1px solid #6bcb7728', marginBottom: 16 }) }}>
              <span style={S.sectionLabel}>✦ UPDATE PLAYLIST</span>
              <p style={{ color: '#333', fontSize: 12, lineHeight: 1.9, margin: '0 0 12px' }}>
                Export at <span style={{ color: '#6bcb77' }}>exportify.net</span> then upload or paste the CSV.<br />
                New tracks get a <span style={{ color: '#00d2d3' }}>NEW</span> badge. Ratings persist across versions.
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button onClick={() => fileRef.current?.click()} style={{ ...S.btn('#16151f', '#777'), fontSize: 10, padding: '9px 14px' }}>
                  📂 UPLOAD CSV
                </button>
                <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
              </div>
              <textarea rows={5} value={csvText} onChange={e => setCsvText(e.target.value)} style={{ ...S.inp, marginBottom: 8 }}
                placeholder={'Exportify CSV format:\nSpotify ID,Artist(s),Track Name,...\n\nor simple format:\nArtist Name - Track Title'} />
              {csvError && <div style={{ color: '#ff6b6b', fontSize: 11, marginBottom: 8 }}>{csvError}</div>}
              {importMsg && <div style={{ color: '#6bcb77', fontSize: 11, marginBottom: 8 }}>{importMsg}</div>}
              <button onClick={handleImport} disabled={!csvText.trim() || importing}
                style={{ ...S.btn('#6bcb77', '#000'), width: '100%', opacity: csvText.trim() && !importing ? 1 : 0.35 }}>
                {importing ? 'IMPORTING...' : 'IMPORT & UPDATE'}
              </button>
            </div>
          )}

          {/* Empty state */}
          {tracks.length < 2 && (
            <div style={{ ...S.card({ textAlign: 'center', padding: '52px 24px' }) }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>🎛️</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 18, color: '#555', marginBottom: 8 }}>
                No playlist loaded
              </div>
              <div style={{ color: '#252530', fontSize: 12, lineHeight: 1.9 }}>
                {djMode ? 'Import a CSV above to get started.' : 'Ask the DJ to load the playlist.'}
              </div>
            </div>
          )}

          {/* Transition cards */}
          {transitions.map(t => {
            const bColor = t.myVote
              ? (t.myVote === 'rainbow' ? '#c77dff44' : (getRating(t.myVote)?.color || '#fff') + '44')
              : '#16151f'
            return (
              <div key={t.key} className="tc" style={{
                background: '#0c0b12', border: `1.5px solid ${bColor}`,
                borderRadius: 14, padding: '14px 14px', marginBottom: 10,
              }}>

                {/* Album art row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  {/* FROM art */}
                  <div style={{ flexShrink: 0, position: 'relative' }}>
                    {t.from.albumArt
                      ? <img src={t.from.albumArt} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
                      : <div style={{ width: 54, height: 54, borderRadius: 8, background: '#18181f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🎵</div>
                    }
                  </div>
                  {/* Arrow */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0, gap: 5 }}>
                    <div style={{ fontSize: 9, letterSpacing: 3, color: '#9490aa', fontWeight: 700 }}>TRANSITION</div>
                    {/* Animated flowing dots */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      {[0, 1, 2, 3, 4].map(i => (
                        <div key={i} style={{
                          width: i === 4 ? 0 : 5,
                          height: i === 4 ? 0 : 5,
                          borderRadius: '50%',
                          background: '#6bcb77',
                          animation: `flowDot ${0.9 + i * 0.05}s ease-in-out ${i * 0.18}s infinite`,
                          opacity: 0.2,
                        }} />
                      ))}
                      <div style={{ color: '#6bcb77', fontSize: 14, marginLeft: 2, lineHeight: 1 }}>›</div>
                    </div>
                  </div>
                  {/* TO art */}
                  {t.to.albumArt
                    ? <img src={t.to.albumArt} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', display: 'block', flexShrink: 0 }} />
                    : <div style={{ width: 54, height: 54, borderRadius: 8, background: '#18181f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎵</div>
                  }
                </div>

                {/* Content + rate button row */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 7 }}>
                      <span style={S.dimLabel}>FROM</span>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#eeeaf8', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'calc(100% - 60px)' }}>{t.from.title}</span>
                        {newTrackIds.has(t.from.id) && <NewBadge />}
                      </div>
                      {t.from.artist && <div style={{ fontSize: 10, color: '#9490aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.from.artist}</div>}
                    </div>

                    <div style={{ fontSize: 9, color: '#6bcb77bb', letterSpacing: 3, marginBottom: 7 }}>↓ MIX INTO</div>

                    <div style={{ marginBottom: 11 }}>
                      <span style={S.dimLabel}>INTO</span>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#eeeaf8', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'calc(100% - 60px)' }}>{t.to.title}</span>
                        {newTrackIds.has(t.to.id) && <NewBadge />}
                      </div>
                      {t.to.artist && <div style={{ fontSize: 10, color: '#9490aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.to.artist}</div>}
                    </div>

                    <VerdictChip allRatings={t.allRatings} />

                    {djMode && Object.keys(t.history).length > 0 && (
                      <div style={{ marginTop: 9, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {Object.entries(t.history).map(([ver, counts]) => {
                          const total = Object.values(counts).reduce((a, b) => a + b, 0)
                          const sc = total ? (counts.green * 3 + (counts.yellow || 0) * 2) / (total * 3) : 0
                          const col = sc >= 0.65 ? '#6bcb77' : sc >= 0.35 ? '#ffd93d' : '#ff6b6b'
                          return (
                            <span key={ver} style={{ fontSize: 10, color: col, background: `${col}12`, border: `1px solid ${col}30`, borderRadius: 5, padding: '2px 7px' }}>
                              {ver}: {total}v
                            </span>
                          )
                        })}
                      </div>
                    )}

                    {djMode && Object.keys(t.allRatings).length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(t.allRatings).map(([name, vote]) => {
                          const rv = getRating(vote)
                          return (
                            <span key={name} style={{
                              fontSize: 10, padding: '2px 8px', borderRadius: 5,
                              background: rv?.isRainbow ? '#c77dff15' : `${rv?.color}15`,
                              color: rv?.isRainbow ? '#c77dff' : rv?.color,
                              border: `1px solid ${rv?.isRainbow ? '#c77dff30' : rv?.color + '30'}`,
                            }}>{name} {rv?.emoji}</span>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Expanding rate button */}
                  <div style={{ paddingTop: 2 }}>
                    <ExpandingRater myVote={t.myVote} onVote={(key) => handleVote(t.index, key)} />
                  </div>
                </div>
              </div>
            )
          })}

          {/* DJ Summary */}
          {djMode && transitions.length > 0 && (
            <div style={{ ...S.card({ marginTop: 8 }) }}>
              <span style={S.sectionLabel}>✦ FULL SUMMARY</span>
              {transitions.map(t => {
                const v = calcVerdict(t.allRatings)
                const r = v ? getRating(v) : null
                const vCount = Object.values(t.allRatings).filter(Boolean).length
                return (
                  <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #10101a' }}>
                    <div style={{ fontSize: 11, color: '#3a3850', maxWidth: '75%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.from.title} → {t.to.title}
                      {t.isNew && <span style={{ color: '#00d2d3', marginLeft: 6 }}>●</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      {vCount > 0 && <span style={{ fontSize: 10, color: '#252530' }}>{vCount}v</span>}
                      {r && (r.isRainbow
                        ? <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, background: RAINBOW, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ELITE</span>
                        : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: r.color }}>{r.label.toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                )
              })}
              <button onClick={async () => {
                if (window.confirm('Reset ALL ratings? This cannot be undone.')) {
                  await deleteAllRatings(); setRatings({})
                }
              }} style={{ ...S.btn('#16151f', '#ff6b6b'), marginTop: 14, width: '100%', fontSize: 10 }}>
                RESET ALL RATINGS
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ TAB: ANALYTICS ═══════════════════════════ */}
      {tab === 'ANALYTICS' && (
        <div style={{ width: '100%', maxWidth: 560 }}>

          {analytics.totalVotes === 0 && (
            <div style={{ ...S.card({ textAlign: 'center', padding: '52px 24px' }) }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>📊</div>
              <div style={{ color: '#252530', fontSize: 12 }}>No votes collected yet. Share with your friends!</div>
            </div>
          )}

          {analytics.totalVotes > 0 && (<>

            {/* Overview stats */}
            <div style={{ ...S.card({ marginBottom: 12 }) }}>
              <span style={S.sectionLabel}>OVERVIEW</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
                {[
                  { label: 'TOTAL VOTES', value: analytics.totalVotes, color: '#6bcb77' },
                  { label: 'VOTERS', value: analytics.totalVoters, color: '#c77dff' },
                  { label: 'AVG / TRANSITION', value: analytics.avgVotesPerTransition, color: '#ffd93d' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center', background: '#13111e', borderRadius: 10, padding: '16px 8px', border: `1px solid ${s.color}33` }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: s.color, fontFamily: "'Playfair Display',serif", lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 8, letterSpacing: 2, color: '#7870a8', marginTop: 6 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Global vote breakdown */}
              <div style={{ fontSize: 9, letterSpacing: 3, color: '#7870a8', marginBottom: 12 }}>VOTE BREAKDOWN</div>
              {RATINGS.map(rv => (
                <div key={rv.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: rv.isRainbow ? '#c77dff' : rv.color, fontWeight: 600 }}>{rv.emoji} {rv.label}</span>
                    <span style={{ fontSize: 11, color: '#9490aa' }}>
                      {analytics.totalVotes > 0 ? Math.round((analytics.globalCounts[rv.key] / analytics.totalVotes) * 100) : 0}%
                    </span>
                  </div>
                  <MiniBar value={analytics.globalCounts[rv.key]} max={analytics.totalVotes} color={rv.isRainbow ? '#c77dff' : rv.color} />
                </div>
              ))}
            </div>

            {/* Verdict breakdown */}
            <div style={{ ...S.card({ marginBottom: 12 }) }}>
              <span style={S.sectionLabel}>VERDICT BREAKDOWN</span>
              {[
                { label: 'KEEP (Fire)', color: '#6bcb77', key: 'green' },
                { label: 'MAYBE (Solid)', color: '#ffd93d', key: 'yellow' },
                { label: 'CHANGE (Drop it)', color: '#ff6b6b', key: 'red' },
                { label: 'ELITE', color: '#c77dff', key: 'rainbow' },
              ].map(({ label, color, key }) => {
                const count = analytics.voted.filter(t => t.verdict === key).length
                return (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #10101a' }}>
                    <span style={{ fontSize: 12, color }}>{label}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'Playfair Display',serif" }}>{count}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                <span style={{ fontSize: 12, color: '#252530' }}>Not yet voted</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#252530', fontFamily: "'Playfair Display',serif" }}>
                  {transitions.length - analytics.voted.length}
                </span>
              </div>
            </div>

            {/* Elites */}
            {analytics.elites.length > 0 && (
              <div style={{ ...S.card({ marginBottom: 12, border: '1px solid #c77dff28' }) }}>
                <span style={{ ...S.sectionLabel, color: '#c77dff' }}>🌈 ELITES</span>
                {analytics.elites.map((t, i) => (
                  <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < analytics.elites.length - 1 ? '1px solid #10101a' : 'none' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#c8c4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.from.title} → {t.to.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#333' }}>{t.counts.rainbow} rainbow vote{t.counts.rainbow !== 1 ? 's' : ''}</div>
                    </div>
                    <span style={{ fontSize: 16, marginLeft: 8 }}>🌈</span>
                  </div>
                ))}
              </div>
            )}

            {/* Top 5 */}
            <div style={{ ...S.card({ marginBottom: 12 }) }}>
              <span style={{ ...S.sectionLabel, color: '#6bcb77' }}>🏆 TOP TRANSITIONS</span>
              {analytics.best.map((t, i) => (
                <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < analytics.best.length - 1 ? '1px solid #10101a' : 'none' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 9, color: '#252530', letterSpacing: 2, marginBottom: 2 }}>#{i + 1}</div>
                    <div style={{ fontSize: 12, color: '#c8c4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.from.title} → {t.to.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#333' }}>{t.total} vote{t.total !== 1 ? 's' : ''}</div>
                  </div>
                  <VerdictChip allRatings={t.allRatings} />
                </div>
              ))}
            </div>

            {/* Bottom 5 */}
            <div style={{ ...S.card({ marginBottom: 12 }) }}>
              <span style={{ ...S.sectionLabel, color: '#ff6b6b' }}>⚠️ NEEDS WORK</span>
              {analytics.worst.map((t, i) => (
                <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < analytics.worst.length - 1 ? '1px solid #10101a' : 'none' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#c8c4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.from.title} → {t.to.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#333' }}>{t.total} vote{t.total !== 1 ? 's' : ''}</div>
                  </div>
                  <VerdictChip allRatings={t.allRatings} />
                </div>
              ))}
            </div>

            {/* Full transition table */}
            <div style={S.card()}>
              <span style={S.sectionLabel}>ALL TRANSITIONS</span>
              {analytics.stats.map((t, i) => {
                const v = t.verdict ? getRating(t.verdict) : null
                return (
                  <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < analytics.stats.length - 1 ? '1px solid #10101a' : 'none' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {i + 1}. {t.from.title} → {t.to.title}
                      </div>
                      <div style={{ fontSize: 9, color: '#252530', display: 'flex', gap: 8, marginTop: 2 }}>
                        {t.counts.rainbow > 0 && <span>🌈{t.counts.rainbow}</span>}
                        {t.counts.green > 0 && <span style={{ color: '#6bcb7766' }}>🟢{t.counts.green}</span>}
                        {t.counts.yellow > 0 && <span style={{ color: '#ffd93d66' }}>🟡{t.counts.yellow}</span>}
                        {t.counts.red > 0 && <span style={{ color: '#ff6b6b66' }}>🔴{t.counts.red}</span>}
                        {t.total === 0 && <span>no votes</span>}
                      </div>
                    </div>
                    {v && (v.isRainbow
                      ? <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, background: RAINBOW, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', flexShrink: 0 }}>ELITE</span>
                      : <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: v.color, flexShrink: 0 }}>{v.label.toUpperCase()}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </>)}
        </div>
      )}

      {/* ══════════════════════════════ TAB: PATCH NOTES ══════════════════════════ */}
      {tab === 'PATCH NOTES' && (
        <div style={{ width: '100%', maxWidth: 560 }}>
          {djMode && (
            <div style={{ ...S.card({ border: '1px solid #6bcb7728', marginBottom: 14 }) }}>
              <span style={S.sectionLabel}>✦ ADD PATCH NOTE</span>
              {!editingPatch ? (
                <button onClick={() => setEditPatch(true)} style={{ ...S.btn('#16151f', '#666'), width: '100%', fontSize: 10 }}>+ NEW ENTRY</button>
              ) : (
                <>
                  <textarea rows={6} value={patchDraft} onChange={e => setPatchDraft(e.target.value)} style={S.inp}
                    placeholder={'One change per line:\n– Added Bicep track after the intro\n– Swapped tracks 6 & 7\n– Removed the slow breakdown'} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={savePatch} style={{ ...S.btn('#6bcb77', '#000'), flex: 1, fontSize: 10 }}>SAVE</button>
                    <button onClick={() => { setEditPatch(false); setPatchDraft('') }} style={{ ...S.btn('#16151f', '#555'), flex: 1, fontSize: 10 }}>CANCEL</button>
                  </div>
                </>
              )}
            </div>
          )}
          {patchNotes.length === 0 ? (
            <div style={{ ...S.card({ textAlign: 'center', padding: '52px 24px' }) }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>📋</div>
              <div style={{ color: '#252530', fontSize: 12 }}>No patch notes yet.</div>
            </div>
          ) : patchNotes.map(note => {
            const isEditing = editingNoteId === note.id
            return (
              <div key={note.id} style={{ ...S.card({ marginBottom: 12, border: isEditing ? '1px solid #6bcb7740' : '1px solid #16151f' }) }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 20, color: '#6bcb77' }}>v{note.version}</span>
                    <span style={{ fontSize: 10, color: '#7870a8', marginLeft: 10, letterSpacing: 1 }}>{note.note_date}</span>
                  </div>
                  {djMode && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {!isEditing ? (
                        <>
                          <button
                            onClick={() => startEditNote(note)}
                            style={{ background: '#1e1c2a', border: '1px solid #3a3560', color: '#9490aa', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8, padding: '4px 10px' }}
                            onMouseEnter={e => { e.currentTarget.style.color = '#c8c4d8'; e.currentTarget.style.borderColor = '#6bcb7766' }}
                            onMouseLeave={e => { e.currentTarget.style.color = '#9490aa'; e.currentTarget.style.borderColor = '#3a3560' }}
                          >edit</button>
                          <button onClick={() => handleDeletePatch(note.id)} style={{ background: 'none', border: 'none', color: '#3a3560', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                            onMouseEnter={e => e.currentTarget.style.color = '#ff6b6b'}
                            onMouseLeave={e => e.currentTarget.style.color = '#3a3560'}
                          >×</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => saveEditedPatch(note.id)} style={{ ...S.btn('#6bcb77', '#000'), fontSize: 10, padding: '5px 12px' }}>save</button>
                          <button onClick={cancelEditNote} style={{ ...S.btn('#1e1c2a', '#9490aa'), fontSize: 10, padding: '5px 12px' }}>cancel</button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Edit mode — textarea */}
                {isEditing ? (
                  <textarea
                    rows={Math.max(3, (note.notes || []).length + 1)}
                    value={editNoteDraft}
                    onChange={e => setEditNoteDraft(e.target.value)}
                    style={{ ...S.inp }}
                    placeholder={'One change per line:\n– Added Bicep track after the intro\n– Swapped tracks 6 & 7'}
                    autoFocus
                  />
                ) : (
                  /* Read mode — list of notes */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(note.notes || []).map((n, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ color: '#6bcb7766', fontSize: 10, marginTop: 2, flexShrink: 0 }}>–</span>
                        <span style={{ fontSize: 12, color: '#7a788a', lineHeight: 1.7 }}>{n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ══════════════════════════════ TAB: ROADMAP ══════════════════════════════ */}
      {tab === 'ROADMAP' && (
        <div style={{ width: '100%', maxWidth: 560 }}>
          {djMode && (
            <div style={{ ...S.card({ border: '1px solid #6bcb7728', marginBottom: 14 }) }}>
              <span style={S.sectionLabel}>✦ ADD ROADMAP ITEMS</span>
              {!editingRoad ? (
                <button onClick={() => setEditRoad(true)} style={{ ...S.btn('#16151f', '#666'), width: '100%', fontSize: 10 }}>+ ADD ITEMS</button>
              ) : (
                <>
                  <textarea rows={6} value={roadDraft} onChange={e => setRoadDraft(e.target.value)} style={S.inp}
                    placeholder={'One idea per line:\nFind a better opener\nAdd a harder techno section mid-set\nTry a classic house closing track'} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={saveRoad} style={{ ...S.btn('#6bcb77', '#000'), flex: 1, fontSize: 10 }}>SAVE</button>
                    <button onClick={() => { setEditRoad(false); setRoadDraft('') }} style={{ ...S.btn('#16151f', '#555'), flex: 1, fontSize: 10 }}>CANCEL</button>
                  </div>
                </>
              )}
            </div>
          )}
          {roadmap.length === 0 ? (
            <div style={{ ...S.card({ textAlign: 'center', padding: '52px 24px' }) }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>🗺️</div>
              <div style={{ color: '#252530', fontSize: 12 }}>Nothing planned yet.</div>
            </div>
          ) : (
            <div style={S.card()}>
              <span style={S.sectionLabel}>PLANNED IMPROVEMENTS</span>
              {roadmap.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid #10101a' }}>
                  <button onClick={() => djMode && handleToggleRoad(item.id, !item.done)} style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 2,
                    border: `1.5px solid ${item.done ? '#6bcb77' : '#252530'}`,
                    background: item.done ? '#6bcb77' : 'none',
                    cursor: djMode ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#000', fontWeight: 700,
                  }}>{item.done ? '✓' : ''}</button>
                  <div style={{ flex: 1, fontSize: 12, color: item.done ? '#252530' : '#8884a0', lineHeight: 1.7, textDecoration: item.done ? 'line-through' : 'none' }}>
                    {item.text}
                  </div>
                  {djMode && <button onClick={() => handleDeleteRoad(item.id)} style={{ background: 'none', border: 'none', color: '#22202e', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>×</button>}
                </div>
              ))}
              {roadmap.filter(r => r.done).length > 0 && (
                <div style={{ marginTop: 12, fontSize: 10, color: '#22202e', textAlign: 'right', letterSpacing: 1 }}>
                  {roadmap.filter(r => r.done).length}/{roadmap.length} DONE
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DJ Login Modal ── */}
      {showDjLogin && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000dd', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ ...S.card({ maxWidth: 340, border: '1px solid #6bcb7730' }) }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: '#6bcb77', marginBottom: 16 }}>DJ Login</div>
            <input type="password" value={djPwInput} onChange={e => setDjPwInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') { if (djPwInput === DJ_PASSWORD) { setDjMode(true); setDjLogin(false); setDjPwInput('') } else setDjError('Wrong password.') } }}
              placeholder="Password..." style={{ ...S.inp, marginBottom: 8 }} />
            {djError && <div style={{ color: '#ff6b6b', fontSize: 11, marginBottom: 8 }}>{djError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { if (djPwInput === DJ_PASSWORD) { setDjMode(true); setDjLogin(false); setDjPwInput('') } else setDjError('Wrong password.') }}
                style={{ ...S.btn('#6bcb77', '#000'), flex: 1, fontSize: 10 }}>ENTER</button>
              <button onClick={() => { setDjLogin(false); setDjPwInput(''); setDjError('') }}
                style={{ ...S.btn('#16151f', '#555'), flex: 1, fontSize: 10 }}>CANCEL</button>
            </div>
            <div style={{ fontSize: 10, color: '#22202e', marginTop: 10 }}>Set VITE_DJ_PASSWORD in your .env file</div>
          </div>
        </div>
      )}

      {/* ── Name Modal ── */}
      {showNameModal && (
        <div style={{ position: 'fixed', inset: 0, background: '#000000dd', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ ...S.card({ maxWidth: 340 }) }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Who are you?</div>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && nameInput.trim()) { setUserName(nameInput.trim()); setNameModal(false) } }}
              placeholder="Your name..." style={{ ...S.inp, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { if (nameInput.trim()) { setUserName(nameInput.trim()); setNameModal(false) } }}
                disabled={!nameInput.trim()} style={{ ...S.btn('#6bcb77', '#000'), flex: 1, fontSize: 10, opacity: nameInput.trim() ? 1 : 0.35 }}>
                CONFIRM
              </button>
              {userName && <button onClick={() => setNameModal(false)} style={{ ...S.btn('#16151f', '#555'), flex: 1, fontSize: 10 }}>CANCEL</button>}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 40, fontSize: 9, letterSpacing: 3, color: '#14131d' }}>LIVE · POWERED BY SUPABASE · DJeNasty</div>
    </div>
  )
}
