alter table app_settings
add column if not exists setup_year text;

update app_settings
set setup_year = case
  when selected_year in ('__all_active_files__', '__active_plus_current_fy_closed__') then financial_year
  else selected_year
end
where setup_year is null or btrim(setup_year) = '';
