create table if not exists user_live_status_preferences (
  owner_key text primary key,
  field_keys jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
