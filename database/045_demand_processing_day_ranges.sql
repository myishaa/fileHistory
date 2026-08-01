alter table app_settings
  add column if not exists demand_processing_day_ranges jsonb not null default
  '[
    {"id":"0-90","label":"0-90","minDays":"0","maxDays":"90"},
    {"id":"91-180","label":"91-180","minDays":"91","maxDays":"180"},
    {"id":"181-365","label":"181-365","minDays":"181","maxDays":"365"},
    {"id":"365-plus","label":"365 and above","minDays":"366","maxDays":""}
  ]'::jsonb;
