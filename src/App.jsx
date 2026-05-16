import { useState, useEffect, useRef, useCallback } from "react";

// ─── Storage helpers ─────────────────────────────────────────────
const KEY = (k) => `djenasty-v4:${k}`;

async function sGet(k) {
  try {
    const r = await window.storage?.get(KEY(k), true);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}

async function sSet(k, v) {
  try {
    await window.storage?.set(KEY(k), JSON.stringify(v), true);
  } catch {}
}

// ─── CSV Parser ──────────────────────────────────────────────────
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
      line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map((c) =>
        c.replace(/^"|"$/g, "").trim()
      ) || [];

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
      } else {
        title = cols[0];
      }
    }

    if (title) {
      tracks.push({
        id: `${artist}::${title}`,
        title,
        artist,
      });
    }
  }

  return tracks;
}

// ─── UI constants ────────────────────────────────────────────────
const TABS = ["RATE", "PATCH NOTES", "ROADMAP"];
const DJ_PASSWORD = "GOATED";

// ─── MAIN APP ────────────────────────────────────────────────────
export default function App() {
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState("RATE");

  const [tracks, setTracks] = useState([]);
  const [ratings, setRatings] = useState({});
  const [ratingHistory, setRatingHistory] = useState({});
  const [currentVersion, setCurrentVersion] = useState(1);

  const [userName, setUserName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);

  const [djMode, setDjMode] = useState(false);
  const [showDjLogin, setShowDjLogin] = useState(false);
  const [djPwInput, setDjPwInput] = useState("");

  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");
  const [importMsg, setImportMsg] = useState("");

  const fileRef = useRef();

  // ─── BOOT (SAFE, NON-BLOCKING) ────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [t, r, h, v] = await Promise.all([
          sGet("tracks"),
          sGet("ratings"),
          sGet("ratingHistory"),
          sGet("version"),
        ]);

        setTracks(t || []);
        setRatings(r || {});
        setRatingHistory(h || {});
        setCurrentVersion(v || 1);
      } catch (e) {
        console.log("Boot fallback:", e);
        setTracks([]);
      } finally {
        setBooted(true);
      }
    })();
  }, []);

  // ─── HELPERS ──────────────────────────────────────────────────
  const tKey = useCallback(
    (i) => `${tracks[i]?.id}|||${tracks[i + 1]?.id}`,
    [tracks]
  );

  // ─── IMPORT CSV ────────────────────────────────────────────────
  const handleImport = async () => {
    setCsvError("");
    setImportMsg("");

    const parsed = parseCSV(csvText);

    if (parsed.length < 2) {
      setCsvError("Need at least 2 tracks.");
      return;
    }

    const newTracks = parsed.map((t) => ({
      ...t,
      addedIn: currentVersion,
    }));

    setTracks(newTracks);
    await sSet("tracks", newTracks);

    setCsvText("");
    setImportMsg(`Imported ${parsed.length} tracks`);
    setTimeout(() => setImportMsg(""), 4000);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target.result);
    reader.readAsText(file);
  };

  // ─── RENDER ────────────────────────────────────────────────────
  if (!booted) {
    return (
      <div style={{ background: "#000", color: "#444", minHeight: "100vh" }}>
        LOADING...
      </div>
    );
  }

  return (
    <div style={{ background: "#07070b", minHeight: "100vh", color: "#ccc", padding: 20 }}>
      <h1>DJeNasty</h1>

      {/* DJ LOGIN */}
      {!djMode && (
        <button onClick={() => setDjMode(true)}>Enter DJ Mode</button>
      )}

      {/* ALWAYS SHOW IMPORT IF NO TRACKS */}
      {(djMode || tracks.length === 0) && (
        <div style={{ border: "1px solid #333", padding: 12, marginTop: 20 }}>
          <h3>Import Playlist</h3>

          <input type="file" ref={fileRef} onChange={handleFile} />

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Paste CSV here..."
            style={{ width: "100%", height: 120, marginTop: 10 }}
          />

          {csvError && <p style={{ color: "red" }}>{csvError}</p>}
          {importMsg && <p style={{ color: "lightgreen" }}>{importMsg}</p>}

          <button onClick={handleImport}>Import</button>
        </div>
      )}

      {/* TRACK LIST */}
      {tracks.length === 0 ? (
        <p>No playlist loaded</p>
      ) : (
        <div>
          {tracks.map((t, i) => (
            <div key={t.id} style={{ padding: 8, borderBottom: "1px solid #222" }}>
              {t.title} {t.artist && `- ${t.artist}`}
            </div>
          ))}
        </div>
      )}

      {/* DEBUG */}
      <pre style={{ color: "#333", fontSize: 10 }}>
        tracks: {tracks.length}
      </pre>
    </div>
  );
}