alter table app_settings
  add column if not exists pre_so_default_so_offset_days integer not null default 30,
  add column if not exists pre_so_default_payment_offset_days integer not null default 30;

alter table app_settings
  drop constraint if exists app_settings_pre_so_default_so_offset_non_negative;
alter table app_settings
  add constraint app_settings_pre_so_default_so_offset_non_negative
  check (pre_so_default_so_offset_days >= 0);

alter table app_settings
  drop constraint if exists app_settings_pre_so_default_payment_offset_non_negative;
alter table app_settings
  add constraint app_settings_pre_so_default_payment_offset_non_negative
  check (pre_so_default_payment_offset_days >= 0);

create table if not exists pre_so_cash_outgo_stage_offsets (
  scope_key text not null,
  stage_key text not null,
  so_offset_days integer not null,
  payment_offset_days integer not null,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scope_key, stage_key),
  constraint pre_so_stage_so_offset_non_negative check (so_offset_days >= 0),
  constraint pre_so_stage_payment_offset_non_negative check (payment_offset_days >= 0)
);

create table if not exists pre_so_cash_outgo_file_plans (
  scope_key text not null,
  file_id uuid not null references files(id) on delete cascade,
  included boolean not null default false,
  tentative_so_date date,
  tentative_payment_date date,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (scope_key, file_id)
);
