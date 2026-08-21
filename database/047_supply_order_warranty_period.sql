alter table supply_orders
  add column if not exists warranty_period_date date;
