create table if not exists cash_out_go_plan_settings (
  id text primary key,
  bill_offset_days integer not null default 5,
  use_custom_bill_offset_days boolean not null default false,
  hand_submission_offset_days integer not null default 5,
  use_custom_hand_submission_offset_days boolean not null default false,
  dp_offset_days integer not null default 10,
  use_custom_dp_offset_days boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint cash_out_go_plan_bill_offset_non_negative check (bill_offset_days >= 0),
  constraint cash_out_go_plan_hand_submission_offset_non_negative
    check (hand_submission_offset_days >= 0),
  constraint cash_out_go_plan_dp_offset_non_negative check (dp_offset_days >= 0)
);

alter table cash_out_go_plan_settings
  drop constraint if exists cash_out_go_plan_settings_singleton;
alter table cash_out_go_plan_settings
  add column if not exists hand_submission_offset_days integer not null default 5;
alter table cash_out_go_plan_settings
  add column if not exists use_custom_bill_offset_days boolean not null default false;
alter table cash_out_go_plan_settings
  add column if not exists use_custom_hand_submission_offset_days boolean not null default false;
alter table cash_out_go_plan_settings
  add column if not exists use_custom_dp_offset_days boolean not null default false;

insert into cash_out_go_plan_settings
  (id, bill_offset_days, hand_submission_offset_days, dp_offset_days)
values ('global', 5, 5, 10)
on conflict (id) do nothing;

create table if not exists cash_out_go_plan_assumptions (
  row_key text primary key,
  expected_sent_date date,
  expected_payment_date date,
  bill_offset_days integer,
  updated_at timestamptz not null default now(),
  constraint cash_out_go_plan_assumption_offset_non_negative
    check (bill_offset_days is null or bill_offset_days >= 0)
);

alter table cash_out_go_plan_assumptions
  add column if not exists expected_payment_date date;
