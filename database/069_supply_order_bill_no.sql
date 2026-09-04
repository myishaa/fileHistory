alter table supply_orders
  add column if not exists bill_no text;
