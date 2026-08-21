alter table app_settings
  add column if not exists bg_receipt_delay_days jsonb not null default
  '[10, 30, 60]'::jsonb;
