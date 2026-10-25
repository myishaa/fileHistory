alter table app_settings
  add column if not exists delay_status_default_days integer not null default 5;

alter table app_settings
  drop constraint if exists app_settings_delay_status_default_days_non_negative;

alter table app_settings
  add constraint app_settings_delay_status_default_days_non_negative
  check (delay_status_default_days >= 0);
