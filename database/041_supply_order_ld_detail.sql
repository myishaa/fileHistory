alter table supply_orders
  add column if not exists ld_type text,
  add column if not exists ld_percentage numeric(5, 2);
