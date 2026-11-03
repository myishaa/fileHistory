create table if not exists backup_run_log (
  id bigserial primary key,
  backup_type text not null check (backup_type in ('local', 'full_recovery', 'server_scheduled')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  file_name text,
  error_message text,
  table_count integer,
  row_count bigint,
  external_storage_included boolean not null default false,
  deployment_config_included boolean not null default false,
  deployment_secrets_included boolean not null default false
);

create index if not exists backup_run_log_type_started_idx
  on backup_run_log (backup_type, started_at desc);
