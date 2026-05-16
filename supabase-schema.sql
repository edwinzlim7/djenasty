-- ═══════════════════════════════════════════════════════════════
--  DJ — Supabase Schema
--  Run this entire file in: Supabase → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- 1. PLAYLIST STATE
--    Stores the current track list and version number.
--    Only one row ever exists (id = 'main').
create table if not exists playlist (
  id          text primary key default 'main',
  tracks      jsonb not null default '[]',
  version     integer not null default 1,
  updated_at  timestamptz default now()
);

-- 2. RATINGS
--    One row per (transition_key, user_name).
--    transition_key is a string like "artist::title|||artist2::title2"
create table if not exists ratings (
  id              bigserial primary key,
  transition_key  text not null,
  user_name       text not null,
  rating          text not null check (rating in ('green','yellow','red','rainbow')),
  updated_at      timestamptz default now(),
  unique (transition_key, user_name)
);

-- 3. RATING HISTORY
--    Snapshot of vote counts per transition per playlist version.
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
--  Everyone can read. Anyone can write ratings.
--  We rely on the DJ password in the frontend for admin actions.
-- ═══════════════════════════════════════════════════════════════

alter table playlist       enable row level security;
alter table ratings        enable row level security;
alter table rating_history enable row level security;
alter table patch_notes    enable row level security;
alter table roadmap        enable row level security;

-- Allow public read on everything
create policy "public read playlist"       on playlist       for select using (true);
create policy "public read ratings"        on ratings        for select using (true);
create policy "public read history"        on rating_history for select using (true);
create policy "public read patch_notes"    on patch_notes    for select using (true);
create policy "public read roadmap"        on roadmap        for select using (true);

-- Allow public insert/update on ratings (anyone can vote)
create policy "public upsert ratings"      on ratings        for insert with check (true);
create policy "public update ratings"      on ratings        for update using (true);
create policy "public delete ratings"      on ratings        for delete using (true);

-- Allow public write on everything else (DJ password enforced in app)
create policy "public write playlist"      on playlist       for all using (true) with check (true);
create policy "public write history"       on rating_history for all using (true) with check (true);
create policy "public write patch_notes"   on patch_notes    for all using (true) with check (true);
create policy "public delete patch_notes"  on patch_notes    for delete using (true);
create policy "public write roadmap"       on roadmap        for all using (true) with check (true);
create policy "public delete roadmap"      on roadmap        for delete using (true);

-- ═══════════════════════════════════════════════════════════════
--  REALTIME
--  Enable realtime so votes appear live for all users.
-- ═══════════════════════════════════════════════════════════════
alter publication supabase_realtime add table ratings;
alter publication supabase_realtime add table playlist;
