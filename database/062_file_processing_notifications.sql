create table if not exists file_processing_notifications (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  division_id uuid references divisions(id) on delete set null,
  changed_by_user_id uuid references app_users(id) on delete set null,
  changed_by_name text not null,
  changed_by_role text not null,
  changes jsonb not null default '[]'::jsonb,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'acknowledged')),
  acknowledged_by_user_id uuid references app_users(id) on delete set null,
  acknowledged_by_name text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists file_processing_notifications_division_status_idx
on file_processing_notifications(division_id, status, created_at desc);

create index if not exists file_processing_notifications_file_idx
on file_processing_notifications(file_id, created_at desc);
