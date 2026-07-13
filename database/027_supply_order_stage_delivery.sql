alter table supply_orders
add column if not exists stage_delivery text,
add column if not exists stage_delivery_count integer,
add column if not exists stage_payment text,
add column if not exists advance_payment text,
add column if not exists advance_payment_detail jsonb not null default '{}'::jsonb,
add column if not exists stage_deliveries jsonb not null default '[]'::jsonb,
add column if not exists actual_payment_capital numeric(14, 2),
add column if not exists actual_payment_revenue numeric(14, 2);
