create table if not exists user_ui_preferences (
  user_id uuid primary key references app_users(id) on delete cascade,
  theme text check (theme in ('light', 'dark')),
  theme_tint text check (
    theme_tint in ('plain', 'yellow', 'green', 'blue', 'pink', 'lavender')
  ),
  updated_at timestamptz not null default now()
);
