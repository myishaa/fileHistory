create table if not exists backup_schedule_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  day_of_week smallint not null default 1 check (day_of_week between 0 and 6),
  time_of_day text not null default '02:00' check (time_of_day ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Asia/Kolkata',
  destination_dir text not null default '',
  retention_count integer not null default 7 check (retention_count between 1 and 90),
  next_run_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_status text not null default 'idle' check (last_status in ('idle', 'running', 'success', 'failed')),
  last_error text,
  last_file_name text,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into backup_schedule_settings (id)
values (true)
on conflict (id) do nothing;
