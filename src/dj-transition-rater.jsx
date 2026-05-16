import { useState, useEffect, useRef, useCallback } from "react";

// ─── Storage helpers (shared across all users) ────────────────────────────
const KEY = (k) => `djenasty-v4:${k}`;
async function sGet(k) {
  try { const r = await window.storage.get(KEY(k), true); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function sSet(k, v) {
  try { await window.storage.set(KEY(k), JSON.stringify(v), true); } catch {}
}

// ─── CSV Parser ───────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (!lines.length) return [];
  const firstLower = lines[0].toLowerCase();
  const hasHeader = firstLower.includes("title") || firstLower.includes("name") || firstLower.includes("track") || firstLower.includes("artist");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const tracks = [];
  for (const line of dataLines) {
    if (!line.trim()) continue;
    const cols = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, "").trim()) || [];
    if (!cols.length) continue;
    let title = "", artist = "";
    if (cols.length >= 3) { artist = cols[1]; title = cols[2]; }
    else if (cols.length === 2) { title = cols[0]; artist = cols[1]; }
    else {
      const dash = cols[0].indexOf(" - ");
      if (dash > -1) { artist = cols[0].slice(0, dash); title = cols[0].slice(dash + 3); }
      else title = cols[0];
    }
    if (title) tracks.push({ id: `${artist}::${title}`, title, artist });
  }
  return tracks;
}

// ─── Rating config ────────────────────────────────────────────────────────
const RAINBOW = "linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#c77dff)";
const RATINGS = [
  { key: "green",   label: "Fire",    color: "#6bcb77", bg: "#6bcb7718", border: "#6bcb7740", emoji: "🟢", score: 3 },
  { key: "yellow",  label: "Solid",   color: "#ffd93d", bg: "#ffd93d18", border: "#ffd93d40", emoji: "🟡", score: 2 },
  { key: "red",     label: "Drop it", color: "#ff6b6b", bg: "#ff6b6b18", border: "#ff6b6b40", emoji: "🔴", score: 0 },
  { key: "rainbow", label: "ANTHEM",  color: "#c77dff", bg: "transparent", border: "transparent", emoji: "🌈", score: 4, isRainbow: true },
];
const getRating = (key) => RATINGS.find(r => r.key === key) || null;

function calcVerdict(allRatings) {
  const votes = Object.values(allRatings).filter(Boolean);
  if (!votes.length) return null;
  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 };
  votes.forEach(v => { if (c[v] !== undefined) c[v]++; });
  if (c.rainbow > 0) return "rainbow";
  const score = (c.green * 3 + c.yellow * 2) / (votes.length * 3);
  if (score >= 0.65) return "green";
  if (score >= 0.35) return "yellow";
  return "red";
}

// ─── Small components ─────────────────────────────────────────────────────
function RainbowText({ children, style = {} }) {
  return <span style={{ background: RAINBOW, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", ...style }}>{children}</span>;
}

function NewBadge() {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, letterSpacing: 2, padding: "2px 6px",
      borderRadius: 4, background: "#00d2d322", color: "#00d2d3",
      border: "1px solid #00d2d355", flexShrink: 0, verticalAlign: "middle",
    }}>NEW</span>
  );
}

function VoteBtn({ ratingKey, active, onClick }) {
  const r = getRating(ratingKey);
  return (
    <button onClick={onClick} title={`${r.label} (${r.emoji})`} style={{
      width: 32, height: 32, borderRadius: "50%", border: "none", cursor: "pointer",
      background: active ? (r.isRainbow ? RAINBOW : r.color) : "#111117",
      boxShadow: active ? (r.isRainbow ? `0 0 18px 5px #c77dff44` : `0 0 14px 4px ${r.color}55`) : "inset 0 2px 5px #00000088",
      transform: active ? "scale(1.22)" : "scale(1)",
      transition: "all 0.18s cubic-bezier(.4,2,.5,1)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 13, flexShrink: 0,
    }}>
      {!active && <span style={{ opacity: 0.25, fontSize: 11 }}>{r.emoji}</span>}
    </button>
  );
}

function VerdictChip({ allRatings }) {
  const votes = Object.values(allRatings).filter(Boolean);
  if (!votes.length) return <span style={{ color: "#252530", fontSize: 11 }}>no votes yet</span>;
  const v = calcVerdict(allRatings);
  const r = getRating(v);
  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 };
  votes.forEach(x => { if (c[x] !== undefined) c[x]++; });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {r.isRainbow ? (
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 2,
          padding: "3px 10px", borderRadius: 5,
          background: RAINBOW, color: "#000",
        }}>ANTHEM</span>
      ) : (
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 2,
          padding: "3px 10px", borderRadius: 5,
          color: r.color, background: r.bg, border: `1px solid ${r.border}`,
        }}>{r.label.toUpperCase()}</span>
      )}
      <span style={{ fontSize: 11, display: "flex", gap: 5 }}>
        {c.rainbow > 0 && <span title="Anthem" style={{ opacity: 0.9 }}>🌈{c.rainbow}</span>}
        {c.green > 0 && <span style={{ color: "#6bcb77" }}>●{c.green}</span>}
        {c.yellow > 0 && <span style={{ color: "#ffd93d" }}>●{c.yellow}</span>}
        {c.red > 0 && <span style={{ color: "#ff6b6b" }}>●{c.red}</span>}
      </span>
    </div>
  );
}

const TABS = ["RATE", "PATCH NOTES", "ROADMAP"];
const DJ_PASSWORD = "GOATED";

// ─── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState("RATE");
  const [tracks, setTracks] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [newTrackIds, setNewTrackIds] = useState(new Set());
  const [ratings, setRatings] = useState({});
  const [ratingHistory, setRatingHistory] = useState({});
  const [userName, setUserName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);
  const [djMode, setDjMode] = useState(false);
  const [showDjLogin, setShowDjLogin] = useState(false);
  const [djPwInput, setDjPwInput] = useState("");
  const [djError, setDjError] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [patchNotes, setPatchNotes] = useState([]);
  const [roadmap, setRoadmap] = useState([]);
  const [editingPatch, setEditingPatch] = useState(false);
  const [editingRoad, setEditingRoad] = useState(false);
  const [patchDraft, setPatchDraft] = useState("");
  const [roadDraft, setRoadDraft] = useState("");
  const fileRef = useRef();

  // Boot
  useEffect(() => {
    (async () => {
      const [t, r, h, v, pn, rm] = await Promise.all([
        sGet("tracks"), sGet("ratings"), sGet("ratingHistory"),
        sGet("version"), sGet("patchNotes"), sGet("roadmap"),
      ]);
      if (t) setTracks(t);
      if (r) setRatings(r);
      if (h) setRatingHistory(h);
      if (v) setCurrentVersion(v);
      if (pn) setPatchNotes(pn);
      if (rm) setRoadmap(rm);
      setBooted(true);
    })();
  }, []);

  // Poll ratings
  useEffect(() => {
    if (!booted) return;
    const id = setInterval(async () => { const r = await sGet("ratings"); if (r) setRatings(r); }, 10000);
    return () => clearInterval(id);
  }, [booted]);

  // Transition key
  const tKey = useCallback((i) => `${tracks[i]?.id}|||${tracks[i + 1]?.id}`, [tracks]);

  // Transitions derived data
  const transitions = tracks.slice(0, -1).map((_, i) => {
    const key = tKey(i);
    return {
      index: i, from: tracks[i], to: tracks[i + 1], key,
      allRatings: ratings[key] || {},
      myVote: userName ? (ratings[key] || {})[userName] || null : null,
      isNew: newTrackIds.has(tracks[i]?.id) || newTrackIds.has(tracks[i + 1]?.id),
      history: ratingHistory[key] || {},
    };
  });

  // Vote
  const handleVote = async (idx, voteKey) => {
    if (!userName) { setShowNameModal(true); return; }
    const key = tKey(idx);
    const existing = ratings[key] || {};
    const updated = { ...existing };
    if (updated[userName] === voteKey) delete updated[userName];
    else updated[userName] = voteKey;
    const newRatings = { ...ratings, [key]: updated };
    setRatings(newRatings);
    await sSet("ratings", newRatings);
  };

  // CSV Import
  const handleImport = async () => {
    setCsvError(""); setImportMsg("");
    const parsed = parseCSV(csvText);
    if (parsed.length < 2) { setCsvError("Need at least 2 tracks. Check format."); return; }
    const oldIds = new Set(tracks.map(t => t.id));
    const addedIds = new Set(parsed.map(t => t.id).filter(id => !oldIds.has(id)));
    const newVersion = currentVersion + 1;

    // Archive current ratings into history
    const newHistory = { ...ratingHistory };
    for (const key of Object.keys(ratings)) {
      if (!newHistory[key]) newHistory[key] = {};
      const votes = ratings[key];
      const counts = { green: 0, yellow: 0, red: 0, rainbow: 0 };
      Object.values(votes).forEach(v => { if (counts[v] !== undefined) counts[v]++; });
      newHistory[key][`v${currentVersion}`] = counts;
    }

    const newTracks = parsed.map(t => ({
      ...t, addedIn: addedIds.has(t.id) ? newVersion : (tracks.find(o => o.id === t.id)?.addedIn || 1),
    }));

    setTracks(newTracks);
    setNewTrackIds(addedIds);
    setCurrentVersion(newVersion);
    setRatingHistory(newHistory);

    await Promise.all([sSet("tracks", newTracks), sSet("ratingHistory", newHistory), sSet("version", newVersion)]);
    setCsvText("");
    setImportMsg(`✓ ${parsed.length} tracks · ${addedIds.size} new · now at v${newVersion}`);
    setTimeout(() => setImportMsg(""), 6000);
  };

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target.result);
    reader.readAsText(file); e.target.value = "";
  };

  // Patch notes
  const savePatch = async () => {
    const lines = patchDraft.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const entry = { version: currentVersion, date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), notes: lines };
    const updated = [entry, ...patchNotes];
    setPatchNotes(updated); await sSet("patchNotes", updated);
    setEditingPatch(false); setPatchDraft("");
  };
  const deletePatch = async (idx) => {
    const updated = patchNotes.filter((_, i) => i !== idx);
    setPatchNotes(updated); await sSet("patchNotes", updated);
  };

  // Roadmap
  const saveRoad = async () => {
    const items = roadDraft.split("\n").map(l => l.trim()).filter(Boolean);
    if (!items.length) return;
    const newItems = items.map((text, i) => ({ id: Date.now() + i, text, done: false }));
    const updated = [...newItems, ...roadmap];
    setRoadmap(updated); await sSet("roadmap", updated);
    setEditingRoad(false); setRoadDraft("");
  };
  const toggleRoad = async (id) => {
    const updated = roadmap.map(r => r.id === id ? { ...r, done: !r.done } : r);
    setRoadmap(updated); await sSet("roadmap", updated);
  };
  const deleteRoad = async (id) => {
    const updated = roadmap.filter(r => r.id !== id);
    setRoadmap(updated); await sSet("roadmap", updated);
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const S = {
    page: {
      minHeight: "100vh", background: "#07070b", color: "#ccc8d8",
      fontFamily: "'Inconsolata','Courier New',monospace",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "0 16px 100px",
      backgroundImage: "radial-gradient(ellipse 80% 40% at 50% 0%, #0d0b1a 0%, transparent 100%)",
    },
    card: (extra = {}) => ({
      background: "#0c0b12", border: "1px solid #16151f",
      borderRadius: 14, padding: "20px 18px",
      width: "100%", maxWidth: 560, ...extra,
    }),
    inp: {
      background: "#08080f", border: "1.5px solid #18172a",
      borderRadius: 9, color: "#ccc8d8",
      fontFamily: "'Inconsolata',monospace", fontSize: 13,
      padding: "11px 13px", width: "100%", outline: "none",
      boxSizing: "border-box", transition: "border-color .2s",
    },
    btn: (bg = "#6bcb77", fg = "#000", extra = {}) => ({
      background: bg, color: fg, fontFamily: "'Inconsolata',monospace",
      fontWeight: 700, fontSize: 11, letterSpacing: 1.5,
      border: "none", borderRadius: 9, padding: "11px 18px",
      cursor: "pointer", transition: "opacity .15s, transform .12s", ...extra,
    }),
  };

  if (!booted) return (
    <div style={{ ...S.page, justifyContent: "center" }}>
      <div style={{ color: "#222", fontSize: 12, letterSpacing: 4 }}>LOADING...</div>
    </div>
  );

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
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ width: "100%", maxWidth: 560, padding: "34px 0 22px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 6, color: "#22202e", marginBottom: 5 }}>DJ TOOLKIT</div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 34, letterSpacing: -1, lineHeight: 1, color: "#e8e4f0" }}>
            Mix<span style={{ background: RAINBOW, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Rater</span>
          </div>
          {tracks.length > 0 && (
            <div style={{ fontSize: 10, color: "#22202e", marginTop: 5, letterSpacing: 2 }}>
              VERSION {currentVersion} · {tracks.length} TRACKS · {transitions.length} TRANSITIONS
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {!djMode
            ? <button onClick={() => { setShowDjLogin(true); setDjError(""); setDjPwInput(""); }} style={{ ...S.btn("#16151f", "#555"), fontSize: 10, padding: "8px 13px" }}>DJ LOGIN</button>
            : <button onClick={() => setDjMode(false)} style={{ ...S.btn("#6bcb77", "#000"), fontSize: 10, padding: "8px 13px" }}>✦ DJ MODE</button>
          }
        </div>
      </div>

      {/* ── NAME PILL ── */}
      <div style={{ width: "100%", maxWidth: 560, marginBottom: 18, display: "flex", gap: 8, alignItems: "center" }}>
        {userName ? (
          <>
            <span style={{ background: "#6bcb7718", border: "1px solid #6bcb7740", borderRadius: 20, padding: "4px 13px", fontSize: 11, color: "#6bcb77" }}>
              👤 {userName}
            </span>
            <button onClick={() => { setNameInput(userName); setShowNameModal(true); }}
              style={{ background: "none", border: "none", color: "#252530", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>change</button>
          </>
        ) : (
          <button onClick={() => setShowNameModal(true)}
            style={{ ...S.btn("#16151f", "#555"), fontSize: 10, padding: "7px 13px" }}>
            SET NAME TO VOTE
          </button>
        )}
      </div>

      {/* ── TABS ── */}
      <div style={{ width: "100%", maxWidth: 560, display: "flex", borderBottom: "1px solid #16151f", marginBottom: 22 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", fontFamily: "'Inconsolata',monospace",
            fontSize: 10, letterSpacing: 2, padding: "10px 14px", cursor: "pointer",
            color: tab === t ? "#6bcb77" : "#2e2c3e",
            borderBottom: `2px solid ${tab === t ? "#6bcb77" : "transparent"}`,
            marginBottom: -1, transition: "color .15s",
          }}>{t}</button>
        ))}
      </div>

      {/* ══════════════ TAB: RATE ══════════════ */}
      {tab === "RATE" && (
        <div style={{ width: "100%", maxWidth: 560 }}>

          {/* DJ: CSV Import */}
          {djMode && (
            <div style={{ ...S.card({ border: "1px solid #6bcb7728", marginBottom: 16 }) }}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: "#6bcb77", marginBottom: 12, fontWeight: 700 }}>✦ UPDATE PLAYLIST</div>
              <p style={{ color: "#333", fontSize: 12, lineHeight: 1.9, margin: "0 0 12px" }}>
                Export at <span style={{ color: "#6bcb77" }}>exportify.net</span> then upload or paste the CSV.<br />
                New tracks get a <span style={{ color: "#00d2d3" }}>NEW</span> badge. All existing ratings are preserved.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => fileRef.current?.click()} style={{ ...S.btn("#16151f", "#777"), fontSize: 10, padding: "9px 14px" }}>📂 UPLOAD CSV</button>
                <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={handleFile} />
              </div>
              <textarea rows={5} value={csvText} onChange={e => setCsvText(e.target.value)} style={{ ...S.inp, marginBottom: 8 }}
                placeholder={"Spotify ID,Artist(s),Track Name,...  (Exportify format)\nor paste as:\nArtist - Track Title\n..."} />
              {csvError && <div style={{ color: "#ff6b6b", fontSize: 11, marginBottom: 8 }}>{csvError}</div>}
              {importMsg && <div style={{ color: "#6bcb77", fontSize: 11, marginBottom: 8 }}>{importMsg}</div>}
              <button onClick={handleImport} disabled={!csvText.trim()}
                style={{ ...S.btn("#6bcb77", "#000"), width: "100%", opacity: csvText.trim() ? 1 : 0.35 }}>
                IMPORT & UPDATE
              </button>
            </div>
          )}

          {/* Empty state */}
          {tracks.length < 2 && (
            <div style={{ ...S.card({ textAlign: "center", padding: "52px 24px" }) }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>🎛️</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 18, color: "#555", marginBottom: 8 }}>No playlist loaded</div>
              <div style={{ color: "#252530", fontSize: 12, lineHeight: 1.9 }}>
                {djMode ? "Import a CSV above to get started." : "Ask the DJ to load the playlist."}
              </div>
            </div>
          )}

          {/* Transitions */}
          {transitions.map(t => {
            const bColor = t.myVote
              ? (t.myVote === "rainbow" ? "#c77dff44" : (getRating(t.myVote)?.color || "#fff") + "44")
              : "#16151f";
            return (
              <div key={t.key} className="tc" style={{
                background: "#0c0b12", border: `1.5px solid ${bColor}`,
                borderRadius: 14, padding: "14px 14px", marginBottom: 10,
                display: "flex", gap: 13, alignItems: "flex-start",
              }}>
                {/* Vote buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 3 }}>
                  {RATINGS.map(rv => (
                    <VoteBtn key={rv.key} ratingKey={rv.key} active={t.myVote === rv.key} onClick={() => handleVote(t.index, rv.key)} />
                  ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* FROM */}
                  <div style={{ marginBottom: 7 }}>
                    <div style={{ fontSize: 8, color: "#22202e", letterSpacing: 3, marginBottom: 2 }}>FROM</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#c8c4d8", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(100% - 60px)" }}>{t.from.title}</span>
                      {newTrackIds.has(t.from.id) && <NewBadge />}
                    </div>
                    {t.from.artist && <div style={{ fontSize: 10, color: "#33303f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.from.artist}</div>}
                  </div>

                  {/* Arrow */}
                  <div style={{ fontSize: 9, color: "#6bcb7744", letterSpacing: 3, marginBottom: 7 }}>↓ MIX INTO</div>

                  {/* INTO */}
                  <div style={{ marginBottom: 11 }}>
                    <div style={{ fontSize: 8, color: "#22202e", letterSpacing: 3, marginBottom: 2 }}>INTO</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#c8c4d8", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(100% - 60px)" }}>{t.to.title}</span>
                      {newTrackIds.has(t.to.id) && <NewBadge />}
                    </div>
                    {t.to.artist && <div style={{ fontSize: 10, color: "#33303f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.to.artist}</div>}
                  </div>

                  <VerdictChip allRatings={t.allRatings} />

                  {/* Version history (DJ only) */}
                  {djMode && Object.keys(t.history).length > 0 && (
                    <div style={{ marginTop: 9, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {Object.entries(t.history).map(([ver, counts]) => {
                        const total = Object.values(counts).reduce((a, b) => a + b, 0);
                        const sc = total ? (counts.green * 3 + (counts.yellow || 0) * 2) / (total * 3) : 0;
                        const col = sc >= 0.65 ? "#6bcb77" : sc >= 0.35 ? "#ffd93d" : "#ff6b6b";
                        return (
                          <span key={ver} style={{ fontSize: 10, color: col, background: `${col}12`, border: `1px solid ${col}30`, borderRadius: 5, padding: "2px 7px" }}>
                            {ver}: {total}v
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Named votes (DJ only) */}
                  {djMode && Object.keys(t.allRatings).length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {Object.entries(t.allRatings).map(([name, vote]) => {
                        const rv = getRating(vote);
                        return (
                          <span key={name} style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 5,
                            background: rv?.isRainbow ? "#c77dff15" : `${rv?.color}15`,
                            color: rv?.isRainbow ? "#c77dff" : rv?.color,
                            border: `1px solid ${rv?.isRainbow ? "#c77dff30" : rv?.color + "30"}`,
                          }}>{name} {rv?.emoji}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* DJ Summary */}
          {djMode && transitions.length > 0 && (
            <div style={{ ...S.card({ marginTop: 8 }) }}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: "#6bcb77", marginBottom: 14, fontWeight: 700 }}>✦ FULL SUMMARY</div>
              {transitions.map(t => {
                const v = calcVerdict(t.allRatings);
                const r = v ? getRating(v) : null;
                const vCount = Object.values(t.allRatings).filter(Boolean).length;
                return (
                  <div key={t.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #10101a" }}>
                    <div style={{ fontSize: 11, color: "#3a3850", maxWidth: "75%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.from.title} → {t.to.title}
                      {t.isNew && <span style={{ color: "#00d2d3", marginLeft: 6 }}>●</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      {vCount > 0 && <span style={{ fontSize: 10, color: "#252530" }}>{vCount}v</span>}
                      {r && (
                        r.isRainbow
                          ? <RainbowText style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>ANTHEM</RainbowText>
                          : <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: r.color }}>{r.label.toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button onClick={() => { if (window.confirm("Reset ALL ratings?")) { setRatings({}); sSet("ratings", {}); } }}
                style={{ ...S.btn("#16151f", "#ff6b6b"), marginTop: 14, width: "100%", fontSize: 10 }}>
                RESET ALL RATINGS
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB: PATCH NOTES ══════════════ */}
      {tab === "PATCH NOTES" && (
        <div style={{ width: "100%", maxWidth: 560 }}>
          {djMode && (
            <div style={{ ...S.card({ border: "1px solid #6bcb7728", marginBottom: 14 }) }}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: "#6bcb77", marginBottom: 12, fontWeight: 700 }}>✦ ADD PATCH NOTE</div>
              {!editingPatch ? (
                <button onClick={() => setEditingPatch(true)} style={{ ...S.btn("#16151f", "#666"), width: "100%", fontSize: 10 }}>+ NEW ENTRY</button>
              ) : (
                <>
                  <textarea rows={6} value={patchDraft} onChange={e => setPatchDraft(e.target.value)} style={S.inp}
                    placeholder={"One change per line:\n– Added Bicep track after the intro\n– Swapped tracks 6 & 7\n– Removed the slow breakdown\n– New closing track"} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={savePatch} style={{ ...S.btn("#6bcb77", "#000"), flex: 1, fontSize: 10 }}>SAVE</button>
                    <button onClick={() => { setEditingPatch(false); setPatchDraft(""); }} style={{ ...S.btn("#16151f", "#555"), flex: 1, fontSize: 10 }}>CANCEL</button>
                  </div>
                </>
              )}
            </div>
          )}

          {patchNotes.length === 0 ? (
            <div style={{ ...S.card({ textAlign: "center", padding: "52px 24px" }) }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>📋</div>
              <div style={{ color: "#252530", fontSize: 12 }}>{djMode ? "No patch notes yet. Add one above." : "No patch notes yet."}</div>
            </div>
          ) : patchNotes.map((note, idx) => (
            <div key={idx} style={{ ...S.card({ marginBottom: 12 }) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 20, color: "#6bcb77" }}>v{note.version}</span>
                  <span style={{ fontSize: 10, color: "#252530", marginLeft: 10, letterSpacing: 1 }}>{note.date}</span>
                </div>
                {djMode && <button onClick={() => deletePatch(idx)} style={{ background: "none", border: "none", color: "#252530", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {note.notes.map((n, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: "#6bcb7766", fontSize: 10, marginTop: 2, flexShrink: 0 }}>–</span>
                    <span style={{ fontSize: 12, color: "#7a788a", lineHeight: 1.7 }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══════════════ TAB: ROADMAP ══════════════ */}
      {tab === "ROADMAP" && (
        <div style={{ width: "100%", maxWidth: 560 }}>
          {djMode && (
            <div style={{ ...S.card({ border: "1px solid #6bcb7728", marginBottom: 14 }) }}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: "#6bcb77", marginBottom: 12, fontWeight: 700 }}>✦ ADD ROADMAP ITEMS</div>
              {!editingRoad ? (
                <button onClick={() => setEditingRoad(true)} style={{ ...S.btn("#16151f", "#666"), width: "100%", fontSize: 10 }}>+ ADD ITEMS</button>
              ) : (
                <>
                  <textarea rows={6} value={roadDraft} onChange={e => setRoadDraft(e.target.value)} style={S.inp}
                    placeholder={"One idea per line:\nFind a better opener track\nAdd a harder techno section mid-set\nExperiment with a slower wind-down\nTry a classic house closing track"} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button onClick={saveRoad} style={{ ...S.btn("#6bcb77", "#000"), flex: 1, fontSize: 10 }}>SAVE</button>
                    <button onClick={() => { setEditingRoad(false); setRoadDraft(""); }} style={{ ...S.btn("#16151f", "#555"), flex: 1, fontSize: 10 }}>CANCEL</button>
                  </div>
                </>
              )}
            </div>
          )}

          {roadmap.length === 0 ? (
            <div style={{ ...S.card({ textAlign: "center", padding: "52px 24px" }) }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>🗺️</div>
              <div style={{ color: "#252530", fontSize: 12 }}>{djMode ? "No roadmap items yet. Add some above." : "Nothing planned yet."}</div>
            </div>
          ) : (
            <div style={S.card()}>
              <div style={{ fontSize: 9, letterSpacing: 4, color: "#33303f", marginBottom: 16 }}>PLANNED IMPROVEMENTS</div>
              {roadmap.map(item => (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid #10101a" }}>
                  <button onClick={() => djMode && toggleRoad(item.id)} style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 2,
                    border: `1.5px solid ${item.done ? "#6bcb77" : "#252530"}`,
                    background: item.done ? "#6bcb77" : "none",
                    cursor: djMode ? "pointer" : "default",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#000", fontWeight: 700,
                  }}>{item.done ? "✓" : ""}</button>
                  <div style={{ flex: 1, fontSize: 12, color: item.done ? "#252530" : "#8884a0", lineHeight: 1.7, textDecoration: item.done ? "line-through" : "none" }}>
                    {item.text}
                  </div>
                  {djMode && (
                    <button onClick={() => deleteRoad(item.id)} style={{ background: "none", border: "none", color: "#22202e", cursor: "pointer", fontSize: 16, flexShrink: 0, lineHeight: 1 }}>×</button>
                  )}
                </div>
              ))}
              {roadmap.filter(r => r.done).length > 0 && (
                <div style={{ marginTop: 12, fontSize: 10, color: "#22202e", textAlign: "right", letterSpacing: 1 }}>
                  {roadmap.filter(r => r.done).length}/{roadmap.length} DONE
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DJ Login Modal ── */}
      {showDjLogin && (
        <div style={{ position: "fixed", inset: 0, background: "#000000dd", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ ...S.card({ maxWidth: 340, border: "1px solid #6bcb7730" }) }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: "#6bcb77", marginBottom: 16 }}>DJ Login</div>
            <input type="password" value={djPwInput} onChange={e => setDjPwInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === "Enter") { if (djPwInput === DJ_PASSWORD) { setDjMode(true); setShowDjLogin(false); } else setDjError("Wrong password."); } }}
              placeholder="Password..." style={{ ...S.inp, marginBottom: 8 }} />
            {djError && <div style={{ color: "#ff6b6b", fontSize: 11, marginBottom: 8 }}>{djError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { if (djPwInput === DJ_PASSWORD) { setDjMode(true); setShowDjLogin(false); setDjPwInput(""); } else setDjError("Wrong password."); }}
                style={{ ...S.btn("#6bcb77", "#000"), flex: 1, fontSize: 10 }}>ENTER</button>
              <button onClick={() => { setShowDjLogin(false); setDjPwInput(""); setDjError(""); }}
                style={{ ...S.btn("#16151f", "#555"), flex: 1, fontSize: 10 }}>CANCEL</button>
            </div>
            <div style={{ fontSize: 10, color: "#22202e", marginTop: 10 }}>Default: dj2024 — change DJ_PASSWORD in the code</div>
          </div>
        </div>
      )}

      {/* ── Name Modal ── */}
      {showNameModal && (
        <div style={{ position: "fixed", inset: 0, background: "#000000dd", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ ...S.card({ maxWidth: 340 }) }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Who are you?</div>
            <input value={nameInput} onChange={e => setNameInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === "Enter" && nameInput.trim()) { setUserName(nameInput.trim()); setShowNameModal(false); } }}
              placeholder="Your name..." style={{ ...S.inp, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { if (nameInput.trim()) { setUserName(nameInput.trim()); setShowNameModal(false); } }}
                disabled={!nameInput.trim()} style={{ ...S.btn("#6bcb77", "#000"), flex: 1, fontSize: 10, opacity: nameInput.trim() ? 1 : 0.35 }}>
                CONFIRM
              </button>
              {userName && <button onClick={() => setShowNameModal(false)} style={{ ...S.btn("#16151f", "#555"), flex: 1, fontSize: 10 }}>CANCEL</button>}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 40, fontSize: 9, letterSpacing: 3, color: "#14131d" }}>LIVE · SHARED ACROSS ALL DEVICES</div>
    </div>
  );
}
