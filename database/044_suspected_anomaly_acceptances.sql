create table if not exists suspected_anomaly_acceptances (
  signature text primary key,
  reason text not null default '',
  accepted_by_user_id uuid references app_users(id) on delete set null,
  accepted_by_name text,
  accepted_at timestamptz not null default now()
);
