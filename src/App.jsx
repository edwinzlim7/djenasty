import { useEffect, useState, useMemo } from "react";
import { supabase } from "./supabaseClient";

const RATINGS = ["green", "yellow", "red", "rainbow"];

export default function App() {
  // ---------------- STATE (SAFE DEFAULTS) ----------------
  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [patchNotes, setPatchNotes] = useState([]);
  const [roadmap, setRoadmap] = useState([]);
  const [userName, setUserName] = useState("");

  const [loading, setLoading] = useState(true);

  // ---------------- INITIAL LOAD ----------------
  useEffect(() => {
    console.log("APP RENDERED");

    loadAll();

    const interval = setInterval(loadRatings, 8000);
    return () => clearInterval(interval);
  }, []);

  // ---------------- LOAD EVERYTHING ----------------
  async function loadAll() {
    setLoading(true);

    await Promise.all([
      loadTracks(),
      loadRatings(),
      loadPatchNotes(),
      loadRoadmap(),
    ]);

    setLoading(false);
  }

  async function loadTracks() {
    const { data } = await supabase
      .from("tracks")
      .select("*")
      .order("created_at", { ascending: true });

    setTracks(data || []);
  }

  async function loadRatings() {
    const { data } = await supabase.from("ratings").select("*");

    const grouped = {};
    (data || []).forEach((r) => {
      if (!grouped[r.transition_key]) grouped[r.transition_key] = {};
      grouped[r.transition_key][r.user_name] = r.rating;
    });

    setRatings(grouped);
  }

  async function loadPatchNotes() {
    const { data } = await supabase
      .from("patch_notes")
      .select("*")
      .order("id", { ascending: false });

    setPatchNotes(data || []);
  }

  async function loadRoadmap() {
    const { data } = await supabase
      .from("roadmap")
      .select("*")
      .order("sort_order", { ascending: true });

    setRoadmap(data || []);
  }

  // ---------------- VOTING ----------------
  async function vote(trackA, trackB, rating) {
    if (!userName) {
      const name = prompt("Enter your name");
      if (!name) return;
      setUserName(name);
    }

    const key = `${trackA}|||${trackB}`;

    await supabase.from("ratings").upsert({
      transition_key: key,
      user_name: userName,
      rating,
      updated_at: new Date(),
    });

    loadRatings();
  }

  // ---------------- UI ----------------
  if (loading) {
    return (
      <div style={{ padding: 40, color: "#fff", background: "#000", minHeight: "100vh" }}>
        Loading DJ App...
      </div>
    );
  }

  return (
    <div style={{ padding: 20, background: "#0b0b10", minHeight: "100vh", color: "#fff" }}>
      <h1>DJeNasty</h1>

      {tracks.length < 2 && <p>No tracks loaded</p>}

      {tracks.slice(0, -1).map((t, i) => {
        const next = tracks[i + 1];
        const key = `${t.id}|||${next?.id}`;
        const votes = ratings[key] || {};

        return (
          <div key={key} style={{ border: "1px solid #333", padding: 10, marginBottom: 10 }}>
            <div>
              {t.title} → {next?.title}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              {RATINGS.map((r) => (
                <button
                  key={r}
                  onClick={() => vote(t.id, next.id, r)}
                >
                  {r}
                </button>
              ))}
            </div>

            <pre style={{ fontSize: 10 }}>
              {JSON.stringify(votes, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}