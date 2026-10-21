alter table supply_orders
  add column if not exists include_in_payment_timing boolean not null default true;
