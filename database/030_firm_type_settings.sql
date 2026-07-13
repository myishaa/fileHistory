alter table app_settings
add column if not exists firm_types jsonb not null
default '["MSE", "MSE (Women)", "Non-MSE"]'::jsonb;

update app_settings
set firm_types = '["MSE", "MSE (Women)", "Non-MSE"]'::jsonb
where firm_types is null or firm_types = '[]'::jsonb;
