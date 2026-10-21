alter table supply_orders
  add column if not exists bill_return_cycles jsonb not null default '[]'::jsonb,
  add column if not exists bill_no text,
  add column if not exists bill_amount_capital numeric(14, 2),
  add column if not exists bill_amount_revenue numeric(14, 2),
  add column if not exists no_further_action text not null default 'No',
  add column if not exists no_further_action_date date,
  add column if not exists actual_job_completion_date date,
  add column if not exists job_completion_date date,
  add column if not exists supplementary_bills jsonb not null default '[]'::jsonb,
  add column if not exists include_in_payment_timing boolean not null default true;

alter table app_settings
  add column if not exists bg_return_offset_days integer not null default 60;
