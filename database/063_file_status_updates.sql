create table if not exists file_status_updates (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  division_id uuid references divisions(id) on delete set null,
  text text not null,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_by_name text not null,
  created_by_role text not null,
  created_at timestamptz not null default now(),
  updated_by_user_id uuid references app_users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz
);

create index if not exists file_status_updates_file_idx
on file_status_updates(file_id, created_at desc);

create index if not exists file_status_updates_division_idx
on file_status_updates(division_id, created_at desc);
