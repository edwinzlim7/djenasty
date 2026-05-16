console.log("APP RENDERED");
useEffect(() => {
  console.log("TRACKS STATE:", tracks);
}, [tracks]);
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// ==============================
// CONFIG
// ==============================
const RATINGS = [
  { key: "green", label: "Fire", color: "#6bcb77", emoji: "🟢", score: 3 },
  { key: "yellow", label: "Solid", color: "#ffd93d", emoji: "🟡", score: 2 },
  { key: "red", label: "Drop", color: "#ff6b6b", emoji: "🔴", score: 0 },
  { key: "rainbow", label: "ANTHEM", color: "#c77dff", emoji: "🌈", score: 4 },
];

const DJ_PASSWORD = "GOATED";

// ==============================
// HELPERS
// ==============================
const getRating = (k) => RATINGS.find((r) => r.key === k);

function groupRatings(rows) {
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.transition_key]) grouped[r.transition_key] = {};
    grouped[r.transition_key][r.user_name] = r.rating;
  });
  return grouped;
}

function verdict(all) {
  const vals = Object.values(all || {});
  if (!vals.length) return null;

  const counts = { green: 0, yellow: 0, red: 0, rainbow: 0 };
  vals.forEach((v) => counts[v]++);

  if (counts.rainbow > 0) return "rainbow";

  const score =
    (counts.green * 3 + counts.yellow * 2) / (vals.length * 3);

  if (score >= 0.65) return "green";
  if (score >= 0.35) return "yellow";
  return "red";
}

// ==============================
// APP
// ==============================
export default function App() {
  const [booted, setBooted] = useState(false);

  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});

  const [userName, setUserName] = useState("");
  const [tab, setTab] = useState("RATE");

  const [djMode, setDjMode] = useState(false);
  const [djInput, setDjInput] = useState("");

  const [patchNotes, setPatchNotes] = useState([]);
  const [roadmap, setRoadmap] = useState([]);

  const fileRef = useRef();

  // ==============================
  // LOAD DATA
  // ==============================
  async function loadAll() {
    const [{ data: t }, { data: r }, { data: p }, { data: rm }] =
      await Promise.all([
        supabase.from("tracks").select("*").order("created_at"),
        supabase.from("ratings").select("*"),
        supabase.from("patch_notes").select("*").order("id", { ascending: false }),
        supabase.from("roadmap").select("*").order("sort_order"),
      ]);

    setTracks(t || []);
    setRatings(groupRatings(r || []));
    setPatchNotes(p || []);
    setRoadmap(rm || []);
  }

  // initial load
  useEffect(() => {
    (async () => {
      await loadAll();
      setBooted(true);
    })();
  }, []);

  // ==============================
  // REALTIME RATINGS
  // ==============================
  useEffect(() => {
    const channel = supabase
      .channel("ratings-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ratings" },
        async () => {
          const { data } = await supabase.from("ratings").select("*");
          setRatings(groupRatings(data || []));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  // ==============================
  // TRANSITIONS
  // ==============================
  const transitions = useMemo(() => {
    return tracks.slice(0, -1).map((t, i) => ({
      from: tracks[i],
      to: tracks[i + 1],
      key: `${tracks[i].id}|||${tracks[i + 1].id}`,
      index: i,
    }));
  }, [tracks]);

  function transitionKey(i) {
    return `${tracks[i].id}|||${tracks[i + 1].id}`;
  }

  // ==============================
  // VOTE (SUPABASE UPSERT)
  // ==============================
  async function vote(i, rating) {
    if (!userName) return alert("Enter name first");

    const key = transitionKey(i);

    await supabase.from("ratings").upsert({
      transition_key: key,
      user_name: userName,
      rating,
      updated_at: new Date(),
    });
  }

  // ==============================
  // DJ LOGIN
  // ==============================
  function login() {
    if (djInput === DJ_PASSWORD) setDjMode(true);
    else alert("Wrong password");
  }

  // ==============================
  // PATCH NOTES
  // ==============================
  async function addPatch(text) {
    const lines = text.split("\n").filter(Boolean);

    await supabase.from("patch_notes").insert({
      version: 1,
      note_date: new Date().toLocaleDateString(),
      notes: lines,
    });

    await loadAll();
  }

  // ==============================
  // ROADMAP
  // ==============================
  async function addRoad(text) {
    const items = text.split("\n").filter(Boolean);

    await supabase.from("roadmap").insert(
      items.map((t, i) => ({
        text: t,
        done: false,
        sort_order: i,
      }))
    );

    await loadAll();
  }

  async function toggleRoad(id, done) {
    await supabase
      .from("roadmap")
      .update({ done: !done })
      .eq("id", id);

    await loadAll();
  }

  // ==============================
  // CSV IMPORT (tracks)
  // ==============================
  async function importCSV(text) {
    const lines = text.split("\n").filter(Boolean);

    const rows = lines.map((l) => {
      const [artist, title] = l.split(" - ");
      return {
        id: `${artist}::${title}`,
        artist,
        title,
      };
    });

    await supabase.from("tracks").upsert(rows);

    await loadAll();
  }

  // ==============================
  // REAL UI (MINIMAL CLEAN VERSION)
  // ==============================
  if (!booted) {
    return <div style={{ color: "#999", padding: 40 }}>Loading...</div>;
  }

  return (
    <div style={{ fontFamily: "monospace", padding: 20, background: "#0b0b10", color: "#ddd", minHeight: "100vh" }}>

      {/* HEADER */}
      <h1>DJ APP</h1>

      <input
        placeholder="Your name"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
      />

      <hr />

      {/* LOGIN */}
      {!djMode ? (
        <div>
          <input
            type="password"
            placeholder="DJ password"
            value={djInput}
            onChange={(e) => setDjInput(e.target.value)}
          />
          <button onClick={login}>Login</button>
        </div>
      ) : (
        <p>DJ MODE ACTIVE</p>
      )}

      <hr />

      {/* TRACKS */}
      <h2>Rate Transitions</h2>

      {transitions.map((t, i) => {
        const key = t.key;
        const all = ratings[key] || {};
        const v = verdict(all);
        const r = getRating(v);

        return (
          <div key={key} style={{ marginBottom: 20, padding: 10, border: "1px solid #222" }}>
            <div>{t.from.title} → {t.to.title}</div>

            <div style={{ display: "flex", gap: 10 }}>
              {RATINGS.map((r) => (
                <button key={r.key} onClick={() => vote(i, r.key)}>
                  {r.emoji}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 5 }}>
              {r ? r.label : "No votes"}
            </div>
          </div>
        );
      })}

      <hr />

      {/* PATCH */}
      {djMode && (
        <button onClick={() => addPatch(prompt("Patch notes"))}>
          Add Patch Notes
        </button>
      )}

      {/* ROADMAP */}
      {djMode && (
        <button onClick={() => addRoad(prompt("Roadmap items"))}>
          Add Roadmap
        </button>
      )}
    </div>
  );
}