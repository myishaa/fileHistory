alter table app_settings
  add column if not exists special_file_markers jsonb not null default '[]'::jsonb;
