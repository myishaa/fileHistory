alter table app_settings
  add column if not exists gem_bidding_modes jsonb not null
  default '["Custom", "Catalogue", "Comparison"]'::jsonb;
