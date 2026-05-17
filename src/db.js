/**
 * db.js — All Supabase queries.
 * Every write is awaited and errors are surfaced.
 */
import { supabase } from './supabase.js'

// ─── Playlist ──────────────────────────────────────────────────────────────
export async function getPlaylist() {
  const { data, error } = await supabase
    .from('playlist')
    .select('*')
    .eq('id', 'main')
    .maybeSingle()
  if (error) { console.error('getPlaylist error:', error.message); return null }
  return data
}

export async function savePlaylist(tracks, version, newTrackIds = []) {
  const { error } = await supabase
    .from('playlist')
    .upsert(
      { id: 'main', tracks, version, new_track_ids: newTrackIds, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
  if (error) { console.error('savePlaylist error:', error.message); throw error }
}

// ─── Ratings ───────────────────────────────────────────────────────────────
export async function getAllRatings() {
  const { data, error } = await supabase
    .from('ratings')
    .select('transition_key, user_name, rating')
  if (error) { console.error('getAllRatings error:', error.message); return {} }
  const map = {}
  for (const row of data || []) {
    if (!map[row.transition_key]) map[row.transition_key] = {}
    map[row.transition_key][row.user_name] = row.rating
  }
  return map
}

export async function upsertRating(transitionKey, userName, rating) {
  const { error } = await supabase
    .from('ratings')
    .upsert(
      { transition_key: transitionKey, user_name: userName, rating, updated_at: new Date().toISOString() },
      { onConflict: 'transition_key,user_name' }
    )
  if (error) { console.error('upsertRating error:', error.message); throw error }
}

export async function deleteRating(transitionKey, userName) {
  // .select() asks Supabase to return the deleted row — confirms the delete actually ran
  const { data, error } = await supabase
    .from('ratings')
    .delete()
    .eq('transition_key', transitionKey)
    .eq('user_name', userName)
    .select()
  if (error) { console.error('deleteRating error:', error.message); throw error }
  return data
}

export async function deleteAllRatings() {
  const { error } = await supabase
    .from('ratings')
    .delete()
    .gte('id', 0)
  if (error) { console.error('deleteAllRatings error:', error.message); throw error }
}

// ─── Rating History ────────────────────────────────────────────────────────
export async function getRatingHistory() {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
  if (error) { console.error('getRatingHistory error:', error.message); return {} }
  const map = {}
  for (const row of data || []) {
    if (!map[row.transition_key]) map[row.transition_key] = {}
    map[row.transition_key][`v${row.version}`] = {
      green:   row.green_count,
      yellow:  row.yellow_count,
      red:     row.red_count,
      rainbow: row.rainbow_count,
    }
  }
  return map
}

export async function saveHistorySnapshot(ratingsMap, version) {
  const rows = []
  for (const [key, votes] of Object.entries(ratingsMap)) {
    const c = { green: 0, yellow: 0, red: 0, rainbow: 0 }
    Object.values(votes).forEach(v => { if (c[v] !== undefined) c[v]++ })
    const total = c.green + c.yellow + c.red + c.rainbow
    if (total === 0) continue
    rows.push({ transition_key: key, version, green_count: c.green, yellow_count: c.yellow, red_count: c.red, rainbow_count: c.rainbow })
  }
  if (!rows.length) return
  const { error } = await supabase
    .from('rating_history')
    .upsert(rows, { onConflict: 'transition_key,version' })
  if (error) { console.error('saveHistorySnapshot error:', error.message); throw error }
}

// ─── Patch Notes ───────────────────────────────────────────────────────────
export async function getPatchNotes() {
  const { data, error } = await supabase
    .from('patch_notes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('getPatchNotes error:', error.message); return [] }
  return data || []
}

export async function addPatchNote(version, noteDate, notes) {
  const { error } = await supabase
    .from('patch_notes')
    .insert({ version, note_date: noteDate, notes })
  if (error) { console.error('addPatchNote error:', error.message); throw error }
}

export async function deletePatchNote(id) {
  const { error } = await supabase
    .from('patch_notes')
    .delete()
    .eq('id', id)
  if (error) { console.error('deletePatchNote error:', error.message); throw error }
}

export async function updatePatchNote(id, notes) {
  const { error } = await supabase
    .from('patch_notes')
    .update({ notes })
    .eq('id', id)
  if (error) { console.error('updatePatchNote error:', error.message); throw error }
}

// ─── Roadmap ───────────────────────────────────────────────────────────────
export async function getRoadmap() {
  const { data, error } = await supabase
    .from('roadmap')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) { console.error('getRoadmap error:', error.message); return [] }
  return data || []
}

export async function addRoadmapItems(items) {
  const { error } = await supabase
    .from('roadmap')
    .insert(items)
  if (error) { console.error('addRoadmapItems error:', error.message); throw error }
}

export async function toggleRoadmapItem(id, done) {
  const { error } = await supabase
    .from('roadmap')
    .update({ done })
    .eq('id', id)
  if (error) { console.error('toggleRoadmapItem error:', error.message); throw error }
}

export async function deleteRoadmapItem(id) {
  const { error } = await supabase
    .from('roadmap')
    .delete()
    .eq('id', id)
  if (error) { console.error('deleteRoadmapItem error:', error.message); throw error }
}

// ─── Realtime ─────────────────────────────────────────────────────────────
// IMPORTANT: DELETE events only carry full row data if you have run:
//   ALTER TABLE ratings REPLICA IDENTITY FULL;
// in your Supabase SQL editor. Without it, payload.old only has {id: X}
// and the onRefreshNeeded fallback fires instead to reload all ratings.
export function subscribeToRatings({ onInsert, onUpdate, onDelete, onRefreshNeeded }) {
  const channel = supabase
    .channel('ratings-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ratings' },
      (payload) => onInsert?.(payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ratings' },
      (payload) => onUpdate?.(payload.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ratings' }, (payload) => {
      if (payload.old?.transition_key && payload.old?.user_name) {
        // Full row data available (REPLICA IDENTITY FULL is set) — update surgically
        onDelete?.(payload.old)
      } else {
        // Partial payload — reload everything from DB to stay in sync
        onRefreshNeeded?.()
      }
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export function subscribeToPlaylist({ onChange }) {
  const channel = supabase
    .channel('playlist-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist' },
      (payload) => onChange?.(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}
