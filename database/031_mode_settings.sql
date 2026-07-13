alter table app_settings
add column if not exists modes jsonb not null
default '["OBM", "PBM", "SBM", "LBM", "LPC"]'::jsonb;

update app_settings
set modes = '["OBM", "PBM", "SBM", "LBM", "LPC"]'::jsonb
where modes is null or modes = '[]'::jsonb;
