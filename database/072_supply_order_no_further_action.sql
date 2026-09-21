alter table supply_orders
  add column if not exists no_further_action text not null default 'No';
