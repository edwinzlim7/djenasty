import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

/* ─────────────────────────────
   STORAGE FALLBACK (optional safety)
───────────────────────────── */
const KEY = (k) => `djenasty-v4:${k}`;

/* ─────────────────────────────
   RATING SYSTEM
───────────────────────────── */
const RAINBOW =
  "linear-gradient(90deg,#ff6b6b,#ffd93d,#6bcb77,#4d96ff,#c77dff)";

const RATINGS = [
  { key: "green", label: "Fire", color: "#6bcb77", emoji: "🟢", score: 3 },
  { key: "yellow", label: "Solid", color: "#ffd93d", emoji: "🟡", score: 2 },
  { key: "red", label: "Drop it", color: "#ff6b6b", emoji: "🔴", score: 0 },
  { key: "rainbow", label: "ANTHEM", color: "#c77dff", emoji: "🌈", score: 4 },
];

const getRating = (k) => RATINGS.find((r) => r.key === k);

function groupRatings(rows = []) {
  const out = {};
  for (const r of rows) {
    if (!out[r.transition_key]) out[r.transition_key] = {};
    out[r.transition_key][r.user_name] = r.rating;
  }
  return out;
}

function calcVerdict(all) {
  const votes = Object.values(all || {});
  if (!votes.length) return null;

  const c = { green: 0, yellow: 0, red: 0, rainbow: 0 };
  votes.forEach((v) => c[v]++);

  if (c.rainbow > 0) return "rainbow";

  const score =
    (c.green * 3 + c.yellow * 2) / (votes.length * 3);

  if (score >= 0.65) return "green";
  if (score >= 0.35) return "yellow";
  return "red";
}

/* ─────────────────────────────
   CSV PARSER (same as your original intent)
───────────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split("\n");
  return lines
    .filter(Boolean)
    .map((l, i) => {
      const [artist, title] = l.split(" - ");
      return {
        id: `${artist || "unknown"}::${title || l}::${i}`,
        title: title || l,
        artist: artist || "",
        added_in: 1,
      };
    });
}

/* ─────────────────────────────
   MAIN APP
───────────────────────────── */
export default function App() {
  const [booted, setBooted] = useState(false);

  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [patchNotes, setPatchNotes] = useState([]);
  const [roadmap, setRoadmap] = useState([]);

  const [tab, setTab] = useState("RATE");

  const [userName, setUserName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);

  const [djMode, setDjMode] = useState(false);
  const [showDjLogin, setShowDjLogin] = useState(false);
  const [djPwInput, setDjPwInput] = useState("");

  const [csvText, setCsvText] = useState("");
  const fileRef = useRef();

  const DJ_PASSWORD = "GOATED";

  /* ─────────────────────────────
     BOOT (FIXED SUPABASE LAYER)
  ───────────────────────────── */
  useEffect(() => {
    (async () => {
      console.log("BOOT START");

      const [{ data: t, error: te },
             { data: r, error: re },
             { data: pn, error: pe },
             { data: rm, error: re2 }] =
        await Promise.all([
          supabase.from("tracks").select("*").order("created_at", { ascending: true }),
          supabase.from("ratings").select("*"),
          supabase.from("patch_notes").select("*"),
          supabase.from("roadmap").select("*"),
        ]);

      if (te || re || pe || re2) {
        console.error({ te, re, pe, re2 });
      }

      setTracks(t || []);
      setRatings(groupRatings(r || []));
      setPatchNotes(pn || []);
      setRoadmap(rm || []);

      console.log("BOOT DONE", t?.length);

      setBooted(true);
    })();
  }, []);

  /* ─────────────────────────────
     TRANSITIONS
  ───────────────────────────── */
  const tKey = useCallback(
    (i) => `${tracks[i]?.id}|||${tracks[i + 1]?.id}`,
    [tracks]
  );

  const transitions = tracks.slice(0, -1).map((_, i) => {
    const key = tKey(i);
    return {
      index: i,
      from: tracks[i],
      to: tracks[i + 1],
      key,
      all: ratings[key] || {},
    };
  });

  /* ─────────────────────────────
     VOTE (FIXED SUPABASE UPSERT)
  ───────────────────────────── */
  const vote = async (idx, value) => {
    if (!userName) return setShowNameModal(true);

    const key = tKey(idx);
    const updated = { ...(ratings[key] || {}) };

    if (updated[userName] === value) delete updated[userName];
    else updated[userName] = value;

    const newRatings = { ...ratings, [key]: updated };
    setRatings(newRatings);

    // flatten into rows for Supabase
    const rows = Object.entries(updated).map(([user_name, rating]) => ({
      transition_key: key,
      user_name,
      rating,
    }));

    await supabase
      .from("ratings")
      .upsert(rows, { onConflict: "transition_key,user_name" });
  };

  /* ─────────────────────────────
     DJ IMPORT (FIXED GATING)
  ───────────────────────────── */
  const importCSV = async () => {
    if (!djMode) {
      setShowDjLogin(true);
      return;
    }

    const parsed = parseCSV(csvText);

    for (const t of parsed) {
      await supabase.from("tracks").insert(t);
    }

    const { data } = await supabase
      .from("tracks")
      .select("*")
      .order("created_at");

    setTracks(data || []);
    setCsvText("");
  };

  /* ─────────────────────────────
     RENDER SAFETY
  ───────────────────────────── */
  if (!booted) {
    return (
      <div style={{ padding: 40, color: "#999" }}>
        Loading DJ App...
      </div>
    );
  }

  /* ─────────────────────────────
     UI (UNCHANGED STRUCTURE)
  ───────────────────────────── */
  return (
    <div style={{ background: "#0b0b10", minHeight: "100vh", color: "#ddd" }}>
      <h1 style={{ padding: 20 }}>DJeNasty</h1>

      {/* NAME */}
      <div style={{ padding: 10 }}>
        {userName ? (
          <span>👤 {userName}</span>
        ) : (
          <button onClick={() => setShowNameModal(true)}>
            Set Name
          </button>
        )}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 10, padding: 10 }}>
        {["RATE", "PATCH", "ROADMAP"].map((t) => (
          <button key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* RATE */}
      {tab === "RATE" && (
        <div style={{ padding: 20 }}>
          {djMode && (
            <div>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <button onClick={importCSV}>Import CSV</button>
            </div>
          )}

          {transitions.map((t, i) => (
            <div key={t.key} style={{ margin: 20, border: "1px solid #333", padding: 10 }}>
              <div>
                {t.from?.title} → {t.to?.title}
              </div>

              {RATINGS.map((r) => (
                <button key={r.key} onClick={() => vote(i, r.key)}>
                  {r.emoji}
                </button>
              ))}

              <div>{Object.keys(t.all).length} votes</div>
            </div>
          ))}
        </div>
      )}

      {/* DJ LOGIN */}
      {showDjLogin && (
        <div style={{ position: "fixed", top: 100, left: 100, background: "#222", padding: 20 }}>
          <input
            value={djPwInput}
            onChange={(e) => setDjPwInput(e.target.value)}
          />
          <button
            onClick={() => {
              if (djPwInput === DJ_PASSWORD) setDjMode(true);
              setShowDjLogin(false);
            }}
          >
            Enter
          </button>
        </div>
      )}

      {/* NAME MODAL */}
      {showNameModal && (
        <div style={{ position: "fixed", top: 100, left: 100, background: "#222", padding: 20 }}>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
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
      )}
    </div>
  );
}