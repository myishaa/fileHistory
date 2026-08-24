alter table suspected_anomaly_acceptances
  add column if not exists rule_key text,
  add column if not exists file_id text,
  add column if not exists status text not null default 'approved_file',
  add column if not exists scope text not null default 'file',
  add column if not exists requested_by_user_id uuid references app_users(id) on delete set null,
  add column if not exists requested_by_name text,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists reviewed_by_user_id uuid references app_users(id) on delete set null,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists revoked_by_user_id uuid references app_users(id) on delete set null,
  add column if not exists revoked_by_name text,
  add column if not exists revoked_at timestamptz,
  add column if not exists admin_message text,
  add column if not exists history_hidden_by_user_ids uuid[] not null default '{}',
  add column if not exists admin_history_cleared_at timestamptz,
  add column if not exists admin_history_cleared_by_user_id uuid references app_users(id) on delete set null,
  add column if not exists admin_history_cleared_by_name text;

update suspected_anomaly_acceptances
set
  status = coalesce(nullif(status, ''), 'approved_file'),
  scope = coalesce(nullif(scope, ''), 'file'),
  requested_by_user_id = coalesce(requested_by_user_id, accepted_by_user_id),
  requested_by_name = coalesce(requested_by_name, accepted_by_name),
  requested_at = coalesce(requested_at, accepted_at),
  reviewed_by_user_id = coalesce(reviewed_by_user_id, accepted_by_user_id),
  reviewed_by_name = coalesce(reviewed_by_name, accepted_by_name),
  reviewed_at = coalesce(reviewed_at, accepted_at)
where true;

create table if not exists anomaly_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  rule_type text not null,
  field_a text not null,
  operator text not null,
  field_b text,
  fixed_value text,
  threshold_days integer,
  severity text not null default 'Medium',
  scope text not null default 'all',
  enabled boolean not null default true,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
