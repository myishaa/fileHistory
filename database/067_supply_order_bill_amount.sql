alter table supply_orders
  add column if not exists bill_amount_capital numeric(14, 2),
  add column if not exists bill_amount_revenue numeric(14, 2);
