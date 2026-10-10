export const SCHEMA_SQL = `
create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create index if not exists folders_owner_idx on folders (owner_id);

create table if not exists albums (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  artist text not null default '',
  kind text not null default 'album' check (kind in ('album', 'playlist')),
  cover_file_id uuid,
  hue integer check (hue between 0 and 360),
  folder_id uuid references folders (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists albums_owner_idx on albums (owner_id, created_at desc);

create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  album_id uuid references albums (id) on delete cascade,
  title text not null,
  artist text not null default '',
  audio_file_id uuid not null,
  audio_type text not null default 'audio/mpeg',
  cover_file_id uuid,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  track_number integer,
  year integer,
  hue integer check (hue between 0 and 360),
  waveform text,
  created_at timestamptz not null default now()
);
create index if not exists tracks_owner_idx on tracks (owner_id, created_at desc);
create index if not exists tracks_album_idx on tracks (album_id);

create table if not exists playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  playlist_id uuid not null references albums (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  position integer not null default 0,
  unique (playlist_id, track_id)
);
create index if not exists playlist_tracks_order_idx on playlist_tracks (playlist_id, position);
`;
