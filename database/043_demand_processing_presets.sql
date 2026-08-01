alter table app_settings
  add column if not exists demand_processing_presets jsonb not null default '[]'::jsonb;
