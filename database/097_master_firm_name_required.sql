alter table master_firms
  drop constraint if exists master_firms_check,
  drop constraint if exists master_firms_name_required;

alter table master_firms
  add constraint master_firms_name_required
  check (nullif(btrim(firm_name), '') is not null) not valid;
