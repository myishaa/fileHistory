alter table supply_orders
  add column if not exists actual_job_completion_date date;
