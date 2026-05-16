import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── CSV Parser ───────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (!lines.length) return [];

  const firstLower = lines[0].toLowerCase();
  const hasHeader =
    firstLower.includes("title") ||
    firstLower.includes("name") ||
    firstLower.includes("track") ||
    firstLower.includes("artist");

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const tracks = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;

    const cols =
      line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, "").trim()) ||
      [];

    if (!cols.length) continue;

    let title = "", artist = "";

    if (cols.length >= 3) {
      artist = cols[1];
      title = cols[2];
    } else if (cols.length === 2) {
      title = cols[0];
      artist = cols[1];
    } else {
      const dash = cols[0].indexOf(" - ");
      if (dash > -1) {
        artist = cols[0].slice(0, dash);
        title = cols[0].slice(dash + 3);
      } else {
        title = cols[0];
      }
    }

    if (title) tracks.push({ id: `${artist}::${title}`, title, artist });
  }

  return tracks;
}

// ─── Ratings ─────────────────────────────────────────────────────────────
const RAINBOW =
  "linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#c77dff)";

const RATINGS = [
  { key: "green", label: "Fire", color: "#6bcb77", emoji: "🟢" },
  { key: "yellow", label: "Solid", color: "#ffd93d", emoji: "🟡" },
  { key: "red", label: "Drop", color: "#ff6b6b", emoji: "🔴" },
  { key: "rainbow", label: "ANTHEM", color: "#c77dff", emoji: "🌈", isRainbow: true }
];

const getRating = (key) => RATINGS.find(r => r.key === key);

// ─── Helpers ─────────────────────────────────────────────────────────────
function calcVerdict(allRatings) {
  const votes = Object.values(allRatings || {});
  if (!votes.length) return null;

  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 };
  votes.forEach(v => c[v] !== undefined && c[v]++);

  if (c.rainbow > 0) return "rainbow";

  const score = (c.green * 3 + c.yellow * 2) / (votes.length * 3);

  if (score >= 0.65) return "green";
  if (score >= 0.35) return "yellow";
  return "red";
}

// ─── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const [booted, setBooted] = useState(false);
  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [userName, setUserName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [currentVersion, setCurrentVersion] = useState(1);

  const fileRef = useRef();

  // ─── LOAD FROM SUPABASE ────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [playlistRes, ratingsRes, versionRes] = await Promise.all([
        supabase.from("playlist").select("*").eq("id", "main").single(),
        supabase.from("ratings").select("*"),
        supabase.from("playlist").select("version").eq("id", "main").single()
      ]);

      if (playlistRes.data) setTracks(playlistRes.data.tracks || []);
      if (versionRes.data) setCurrentVersion(versionRes.data.version || 1);

      // group ratings
      const grouped = {};
      (ratingsRes.data || []).forEach(r => {
        if (!grouped[r.transition_key]) grouped[r.transition_key] = {};
        grouped[r.transition_key][r.user_name] = r.rating;
      });

      setRatings(grouped);
      setBooted(true);
    };

    load();
  }, []);

  // ─── REALTIME ──────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("ratings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ratings" },
        async () => {
          const { data } = await supabase.from("ratings").select("*");

          const grouped = {};
          (data || []).forEach(r => {
            if (!grouped[r.transition_key]) grouped[r.transition_key] = {};
            grouped[r.transition_key][r.user_name] = r.rating;
          });

          setRatings(grouped);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "playlist" },
        async () => {
          const { data } = await supabase
            .from("playlist")
            .select("*")
            .eq("id", "main")
            .single();

          if (data) setTracks(data.tracks || []);
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ─── TRANSITIONS ───────────────────────────────────────────────────────
  const tKey = useCallback((i) => {
    return `${tracks[i]?.id}|||${tracks[i + 1]?.id}`;
  }, [tracks]);

  const transitions = tracks.slice(0, -1).map((_, i) => ({
    index: i,
    from: tracks[i],
    to: tracks[i + 1],
    key: tKey(i),
    allRatings: ratings[tKey(i)] || {},
    myVote: userName ? ratings[tKey(i)]?.[userName] : null
  }));

  // ─── VOTE ───────────────────────────────────────────────────────────────
  const handleVote = async (idx, voteKey) => {
    if (!userName) return setShowNameModal(true);

    const key = tKey(idx);
    const existing = ratings[key]?.[userName];

    if (existing === voteKey) {
      await supabase
        .from("ratings")
        .delete()
        .eq("transition_key", key)
        .eq("user_name", userName);
      return;
    }

    await supabase.from("ratings").upsert({
      transition_key: key,
      user_name: userName,
      rating: voteKey
    });
  };

  // ─── IMPORT PLAYLIST ───────────────────────────────────────────────────
  const handleImport = async () => {
    const parsed = parseCSV(csvText);
    if (parsed.length < 2) return;

    const newVersion = currentVersion + 1;

    setTracks(parsed);
    setCurrentVersion(newVersion);

    await supabase.from("playlist").upsert({
      id: "main",
      tracks: parsed,
      version: newVersion
    });

    setCsvText("");
  };

  // ─── UI ───────────────────────────────────────────────────────────────
  if (!booted) {
    return (
      <div style={{ color: "#333", padding: 40 }}>Loading...</div>
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: "monospace", color: "#ddd" }}>

      <h1>DJ App (Supabase)</h1>

      {/* NAME */}
      <div style={{ marginBottom: 20 }}>
        {userName ? (
          <div>👤 {userName}</div>
        ) : (
          <button onClick={() => setShowNameModal(true)}>
            Set Name
          </button>
        )}
      </div>

      {/* IMPORT */}
      <div style={{ marginBottom: 20 }}>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="Paste Spotify CSV"
          rows={4}
          style={{ width: "100%" }}
        />
        <button onClick={handleImport}>
          Import Playlist
        </button>
      </div>

      {/* TRANSITIONS */}
      {transitions.map((t, i) => (
        <div key={t.key} style={{ border: "1px solid #333", marginBottom: 10, padding: 10 }}>

          <div>{t.from.title} → {t.to.title}</div>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            {RATINGS.map(r => (
              <button
                key={r.key}
                onClick={() => handleVote(i, r.key)}
                style={{
                  background: t.myVote === r.key ? r.color : "#111",
                  color: "#fff"
                }}
              >
                {r.emoji}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 6 }}>
            Votes: {Object.keys(t.allRatings).length}
          </div>
        </div>
      ))}

      {/* NAME MODAL */}
      {showNameModal && (
        <div style={{ position: "fixed", inset: 0, background: "#0008" }}>
          <div style={{ background: "#111", padding: 20, margin: 100 }}>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
            />
            <button
              onClick={() => {
                setUserName(nameInput);
                setShowNameModal(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

    </div>
  );
}