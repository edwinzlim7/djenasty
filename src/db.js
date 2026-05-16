/**
 * db.js — All Supabase queries in one place.
 * The App imports from here; swap this file to change your backend.
 */
import { supabase } from './supabase.js'

// ─── Playlist ──────────────────────────────────────────────────────────────

export async function getPlaylist() {
  const { data, error } = await supabase
    .from('playlist')
    .select('*')
    .eq('id', 'main')
    .maybeSingle()
  if (error) console.error('getPlaylist:', error)
  return data // { id, tracks, version, updated_at } or null
}

export async function savePlaylist(tracks, version) {
  const { error } = await supabase
    .from('playlist')
    .upsert({ id: 'main', tracks, version, updated_at: new Date().toISOString() })
  if (error) console.error('savePlaylist:', error)
}

// ─── Ratings ───────────────────────────────────────────────────────────────

export async function getAllRatings() {
  const { data, error } = await supabase
    .from('ratings')
    .select('transition_key, user_name, rating')
  if (error) console.error('getAllRatings:', error)
  // reshape: { [transition_key]: { [user_name]: rating } }
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
  if (error) console.error('upsertRating:', error)
}

export async function deleteRating(transitionKey, userName) {
  const { error } = await supabase
    .from('ratings')
    .delete()
    .eq('transition_key', transitionKey)
    .eq('user_name', userName)
  if (error) console.error('deleteRating:', error)
}

export async function deleteAllRatings() {
  const { error } = await supabase
    .from('ratings')
    .delete()
    .neq('id', 0) // delete all rows
  if (error) console.error('deleteAllRatings:', error)
}

// ─── Rating History ────────────────────────────────────────────────────────

export async function getRatingHistory() {
  const { data, error } = await supabase
    .from('rating_history')
    .select('*')
  if (error) console.error('getRatingHistory:', error)
  // reshape: { [transition_key]: { v1: {green,yellow,red,rainbow}, ... } }
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
  // Converts current ratings into per-transition counts and upserts
  const rows = []
  for (const [key, votes] of Object.entries(ratingsMap)) {
    const c = { green: 0, yellow: 0, red: 0, rainbow: 0 }
    Object.values(votes).forEach(v => { if (c[v] !== undefined) c[v]++ })
    rows.push({
      transition_key: key,
      version,
      green_count:   c.green,
      yellow_count:  c.yellow,
      red_count:     c.red,
      rainbow_count: c.rainbow,
    })
  }
  if (!rows.length) return
  const { error } = await supabase
    .from('rating_history')
    .upsert(rows, { onConflict: 'transition_key,version' })
  if (error) console.error('saveHistorySnapshot:', error)
}

// ─── Patch Notes ───────────────────────────────────────────────────────────

export async function getPatchNotes() {
  const { data, error } = await supabase
    .from('patch_notes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) console.error('getPatchNotes:', error)
  return data || []
}

export async function addPatchNote(version, noteDate, notes) {
  const { error } = await supabase
    .from('patch_notes')
    .insert({ version, note_date: noteDate, notes })
  if (error) console.error('addPatchNote:', error)
}

export async function deletePatchNote(id) {
  const { error } = await supabase
    .from('patch_notes')
    .delete()
    .eq('id', id)
  if (error) console.error('deletePatchNote:', error)
}

// ─── Roadmap ───────────────────────────────────────────────────────────────

export async function getRoadmap() {
  const { data, error } = await supabase
    .from('roadmap')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) console.error('getRoadmap:', error)
  return data || []
}

export async function addRoadmapItems(items) {
  // items: [{ text, sort_order }]
  const { error } = await supabase
    .from('roadmap')
    .insert(items)
  if (error) console.error('addRoadmapItems:', error)
}

export async function toggleRoadmapItem(id, done) {
  const { error } = await supabase
    .from('roadmap')
    .update({ done })
    .eq('id', id)
  if (error) console.error('toggleRoadmapItem:', error)
}

export async function deleteRoadmapItem(id) {
  const { error } = await supabase
    .from('roadmap')
    .delete()
    .eq('id', id)
  if (error) console.error('deleteRoadmapItem:', error)
}

// ─── Realtime subscription ─────────────────────────────────────────────────

/**
 * Subscribe to live rating changes.
 * onInsert / onUpdate / onDelete each receive the changed row.
 * Returns an unsubscribe function.
 */
export function subscribeToRatings({ onInsert, onUpdate, onDelete }) {
  const channel = supabase
    .channel('ratings-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ratings' }, (payload) => onInsert?.(payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ratings' }, (payload) => onUpdate?.(payload.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ratings' }, (payload) => onDelete?.(payload.old))
    .subscribe()

  return () => supabase.removeChannel(channel)
}
