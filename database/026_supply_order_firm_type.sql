alter table supply_orders
add column if not exists firm_type text,
add column if not exists firm_type_other text;

create index if not exists supply_orders_firm_type_other_trgm_idx
on supply_orders using gin (firm_type_other gin_trgm_ops);
