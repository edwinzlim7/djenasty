import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

// ─── ENABLE SUPABASE ─────────────────────────────
const USE_SUPABASE = true;

// ─── Storage helpers (fallback mode) ─────────────
const KEY = (k) => `djenasty-v4:${k}`;

async function sGet(k) {
  try {
    const r = await window.storage.get(KEY(k), true);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

async function sSet(k, v) {
  try {
    await window.storage.set(KEY(k), JSON.stringify(v), true);
  } catch {}
}

// ─── SUPABASE DATA LAYER ─────────────────────────
async function loadTracks() {
  try {
    if (!USE_SUPABASE) return (await sGet("tracks")) || [];

    const { data, error } = await supabase
      .from("tracks")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

async function loadRatings() {
  try {
    if (!USE_SUPABASE) return (await sGet("ratings")) || {};

    const { data, error } = await supabase.from("ratings").select("*");
    if (error) return {};

    const grouped = {};
    data.forEach((r) => {
      if (!grouped[r.transition_key]) grouped[r.transition_key] = {};
      grouped[r.transition_key][r.user_name] = r.rating;
    });

    return grouped;
  } catch {
    return {};
  }
}

// ─── CSV Parser ──────────────────────────────────
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
      line
        .match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)
        ?.map((c) => c.replace(/^"|"$/g, "").trim()) || [];

    if (!cols.length) continue;

    let title = "",
      artist = "";

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
      } else title = cols[0];
    }

    if (title) tracks.push({ id: `${artist}::${title}`, title, artist });
  }

  return tracks;
}

// ─── Rating config ───────────────────────────────
const RAINBOW =
  "linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#c77dff)";

const RATINGS = [
  { key: "green", label: "Fire", color: "#6bcb77", bg: "#6bcb7718", border: "#6bcb7740", emoji: "🟢" },
  { key: "yellow", label: "Solid", color: "#ffd93d", bg: "#ffd93d18", border: "#ffd93d40", emoji: "🟡" },
  { key: "red", label: "Drop it", color: "#ff6b6b", bg: "#ff6b6b18", border: "#ff6b6b40", emoji: "🔴" },
  { key: "rainbow", label: "ANTHEM", color: "#c77dff", bg: "transparent", border: "transparent", emoji: "🌈", isRainbow: true },
];

const getRating = (key) => RATINGS.find((r) => r.key === key);

// ─── MAIN APP ────────────────────────────────────
export default function App() {
  const [booted, setBooted] = useState(false);
  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [userName, setUserName] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);

  const fileRef = useRef();

  // ─── SAFE BOOT (FIXED CRASH) ───────────────────
  useEffect(() => {
    (async () => {
      const [t, r] = await Promise.all([loadTracks(), loadRatings()]);

      setTracks(Array.isArray(t) ? t : []);
      setRatings(r || {});
      setBooted(true);
    })();
  }, []);

  // ─── SAFE TRANSITIONS ──────────────────────────
  const safeTracks = Array.isArray(tracks) ? tracks : [];

  const tKey = useCallback(
    (i) => `${safeTracks[i]?.id}|||${safeTracks[i + 1]?.id}`,
    [safeTracks]
  );

  const transitions = safeTracks.slice(0, -1).map((_, i) => {
    const key = tKey(i);

    return {
      index: i,
      from: safeTracks[i],
      to: safeTracks[i + 1],
      key,
      allRatings: ratings[key] || {},
      myVote: userName ? ratings[key]?.[userName] : null,
    };
  });

  // ─── VOTE (SUPABASE SAFE) ──────────────────────
  const handleVote = async (idx, voteKey) => {
    if (!userName) {
      setShowNameModal(true);
      return;
    }

    const key = tKey(idx);

    const existing = ratings[key] || {};
    const updated = { ...existing };

    if (updated[userName] === voteKey) delete updated[userName];
    else updated[userName] = voteKey;

    const newRatings = { ...ratings, [key]: updated };
    setRatings(newRatings);

    try {
      if (USE_SUPABASE) {
        await supabase.from("ratings").upsert({
          transition_key: key,
          user_name: userName,
          rating: voteKey,
        });
      } else {
        await sSet("ratings", newRatings);
      }
    } catch (e) {
      console.log("vote error", e);
    }
  };

  // ─── CSV IMPORT (LOCAL ONLY SAFE) ──────────────
  const handleImport = async () => {
    const parsed = parseCSV(""); // (kept safe placeholder)
    setTracks(parsed);
    await sSet("tracks", parsed);
  };

  // ─── LOADING STATE ─────────────────────────────
  if (!booted) {
    return (
      <div style={{ color: "#fff", background: "#000", height: "100vh" }}>
        LOADING...
      </div>
    );
  }

  // ─── UI (UNCHANGED STRUCTURE) ───────────────────
  return (
    <div style={{ padding: 20, color: "#fff", background: "#0b0b10" }}>
      <h1>DJeNasty</h1>

      {safeTracks.length < 2 && (
        <p>No tracks loaded</p>
      )}

      {transitions.map((t) => (
        <div key={t.key} style={{ marginBottom: 20 }}>
          <div>
            {t.from?.title} → {t.to?.title}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {RATINGS.map((r) => (
              <button
                key={r.key}
                onClick={() => handleVote(t.index, r.key)}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* NAME MODAL */}
      {showNameModal && (
        <div style={{ position: "fixed", top: 0 }}>
          <input
            placeholder="Name"
            onChange={(e) => setUserName(e.target.value)}
          />
          <button onClick={() => setShowNameModal(false)}>
            Save
          </button>
        </div>
      )}
    </div>
  );
}