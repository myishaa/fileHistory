alter table supply_orders
add column if not exists current_milestone text,
add column if not exists completed_milestones jsonb not null default '[]'::jsonb;
