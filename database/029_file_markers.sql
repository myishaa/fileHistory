create table if not exists file_markers (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  sort_order integer not null default 0
);

create index if not exists file_markers_file_id_idx on file_markers(file_id);
create index if not exists file_markers_text_trgm_idx on file_markers using gin (text gin_trgm_ops);
