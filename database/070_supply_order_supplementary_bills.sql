alter table supply_orders
  add column if not exists supplementary_bills jsonb not null default '[]'::jsonb;
