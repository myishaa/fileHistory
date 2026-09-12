alter table app_users
  add column if not exists cash_outgo_edit_scope text not null default 'none';

alter table app_users
  drop constraint if exists app_users_cash_outgo_edit_scope_check;

alter table app_users
  add constraint app_users_cash_outgo_edit_scope_check
  check (cash_outgo_edit_scope in ('none', 'personal', 'global'));

alter table cash_out_go_plan_assumptions
  add column if not exists scope_key text not null default 'global';

alter table cash_out_go_plan_assumptions
  add column if not exists expected_payment_date date;

alter table cash_out_go_plan_assumptions
  drop constraint if exists cash_out_go_plan_assumptions_pkey;

alter table cash_out_go_plan_assumptions
  add primary key (scope_key, row_key);
