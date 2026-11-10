alter table app_settings
  add column if not exists table_field_presets_configured boolean not null default false;

-- Existing non-empty values were already configured. Keep the empty seed value
-- eligible for the application's built-in defaults until an explicit save.
update app_settings
set table_field_presets_configured = true
where table_field_presets_configured = false
  and jsonb_typeof(table_field_presets) = 'array'
  and jsonb_array_length(table_field_presets) > 0;
