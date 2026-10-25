alter table app_settings
  add column if not exists quick_entry_excel_presets jsonb not null default '[]'::jsonb;

alter table app_settings
  add column if not exists quick_entry_excel_presets_legacy_imported boolean not null default false;
