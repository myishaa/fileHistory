create table if not exists user_report_preferences (
  user_id uuid not null references app_users(id) on delete cascade,
  report_key text not null,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, report_key)
);
