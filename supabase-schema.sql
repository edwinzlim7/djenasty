-- ═══════════════════════════════════════════════════════
-- DJ APP — CLEAN SUPABASE SCHEMA (v2)
-- ═══════════════════════════════════════════════════════

-- =========================
-- 1. TRACKS (playlist)
-- =========================
create table if not exists tracks (
  id text primary key,
  title text not null,
  artist text,
  added_in integer default 1,
  created_at timestamptz default now()
);

-- =========================
-- 2. RATINGS (core system)
-- =========================
create table if not exists ratings (
  id bigserial primary key,
  transition_key text not null,
  user_name text not null,
  rating text not null check (rating in ('green','yellow','red','rainbow')),
  updated_at timestamptz default now(),
  unique (transition_key, user_name)
);

-- =========================
-- 3. PATCH NOTES
-- =========================
create table if not exists patch_notes (
  id bigserial primary key,
  version integer not null,
  note_date text not null,
  notes text[] not null default '{}',
  created_at timestamptz default now()
);

-- =========================
-- 4. ROADMAP
-- =========================
create table if not exists roadmap (
  id bigserial primary key,
  text text not null,
  done boolean default false,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════

alter table tracks enable row level security;
alter table ratings enable row level security;
alter table patch_notes enable row level security;
alter table roadmap enable row level security;

-- =========================
-- PUBLIC READ (everyone can view)
-- =========================
create policy "public read tracks"
on tracks for select using (true);

create policy "public read ratings"
on ratings for select using (true);

create policy "public read patch_notes"
on patch_notes for select using (true);

create policy "public read roadmap"
on roadmap for select using (true);

-- =========================
-- RATINGS (anyone can vote)
-- =========================
create policy "public insert ratings"
on ratings for insert with check (true);

create policy "public update ratings"
on ratings for update using (true);

create policy "public delete ratings"
on ratings for delete using (true);

-- =========================
-- DJ CONTROLLED TABLES (still public write as per your model)
-- NOTE: you are enforcing admin via frontend password
-- =========================

create policy "public write tracks"
on tracks for all using (true) with check (true);

create policy "public write patch_notes"
on patch_notes for all using (true) with check (true);

create policy "public write roadmap"
on roadmap for all using (true) with check (true);

-- ═══════════════════════════════════════════════
-- REALTIME
-- ═══════════════════════════════════════════════

alter publication supabase_realtime add table ratings;
alter publication supabase_realtime add table tracks;