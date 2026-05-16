-- ═══════════════════════════════════════════════════════════════
--  MixRater — Supabase Schema  (run this in SQL Editor)
--
--  If you already ran a previous version, run the ALTER TABLE
--  lines at the bottom to add the new column without losing data.
-- ═══════════════════════════════════════════════════════════════

-- 1. PLAYLIST
--    Single row (id = 'main'). Stores track list, version, and
--    which track IDs are "new" since the last import.
create table if not exists playlist (
  id              text primary key default 'main',
  tracks          jsonb not null default '[]',
  version         integer not null default 1,
  new_track_ids   jsonb not null default '[]',
  updated_at      timestamptz default now()
);

-- 2. RATINGS — one row per (transition, user)
create table if not exists ratings (
  id              bigserial primary key,
  transition_key  text not null,
  user_name       text not null,
  rating          text not null check (rating in ('green','yellow','red','rainbow')),
  updated_at      timestamptz default now(),
  unique (transition_key, user_name)
);

-- 3. RATING HISTORY — snapshot of vote counts per version
create table if not exists rating_history (
  id              bigserial primary key,
  transition_key  text not null,
  version         integer not null,
  green_count     integer not null default 0,
  yellow_count    integer not null default 0,
  red_count       integer not null default 0,
  rainbow_count   integer not null default 0,
  unique (transition_key, version)
);

-- 4. PATCH NOTES
create table if not exists patch_notes (
  id          bigserial primary key,
  version     integer not null,
  note_date   text not null,
  notes       jsonb not null default '[]',
  created_at  timestamptz default now()
);

-- 5. ROADMAP
create table if not exists roadmap (
  id          bigserial primary key,
  text        text not null,
  done        boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

alter table playlist       enable row level security;
alter table ratings        enable row level security;
alter table rating_history enable row level security;
alter table patch_notes    enable row level security;
alter table roadmap        enable row level security;

-- Drop old policies if re-running this script
do $$ begin
  drop policy if exists "public read playlist"      on playlist;
  drop policy if exists "public write playlist"     on playlist;
  drop policy if exists "public read ratings"       on ratings;
  drop policy if exists "public upsert ratings"     on ratings;
  drop policy if exists "public update ratings"     on ratings;
  drop policy if exists "public delete ratings"     on ratings;
  drop policy if exists "public read history"       on rating_history;
  drop policy if exists "public write history"      on rating_history;
  drop policy if exists "public read patch_notes"   on patch_notes;
  drop policy if exists "public write patch_notes"  on patch_notes;
  drop policy if exists "public delete patch_notes" on patch_notes;
  drop policy if exists "public read roadmap"       on roadmap;
  drop policy if exists "public write roadmap"      on roadmap;
  drop policy if exists "public delete roadmap"     on roadmap;
end $$;

-- Playlist: full public access (DJ password enforced in app)
create policy "public read playlist"    on playlist for select using (true);
create policy "public write playlist"   on playlist for all    using (true) with check (true);

-- Ratings: full public access (anyone can vote)
create policy "public read ratings"     on ratings for select using (true);
create policy "public upsert ratings"   on ratings for insert with check (true);
create policy "public update ratings"   on ratings for update using (true);
create policy "public delete ratings"   on ratings for delete using (true);

-- History, patch notes, roadmap: full public access
create policy "public read history"       on rating_history for select using (true);
create policy "public write history"      on rating_history for all    using (true) with check (true);
create policy "public read patch_notes"   on patch_notes    for select using (true);
create policy "public write patch_notes"  on patch_notes    for insert with check (true);
create policy "public delete patch_notes" on patch_notes    for delete using (true);
create policy "public read roadmap"       on roadmap        for select using (true);
create policy "public write roadmap"      on roadmap        for all    using (true) with check (true);
create policy "public delete roadmap"     on roadmap        for delete using (true);

-- ═══════════════════════════════════════════════════════════════
--  REALTIME
-- ═══════════════════════════════════════════════════════════════
alter publication supabase_realtime add table ratings;
alter publication supabase_realtime add table playlist;

-- ═══════════════════════════════════════════════════════════════
--  MIGRATION — run these if you already have tables from before
--  (safe to run even on a fresh setup, IF NOT EXISTS handles it)
-- ═══════════════════════════════════════════════════════════════
alter table playlist add column if not exists new_track_ids jsonb not null default '[]';
