alter table supply_orders
  add column if not exists job_completion_date date;
