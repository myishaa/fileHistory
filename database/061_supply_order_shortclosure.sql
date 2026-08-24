alter table files add column if not exists shortclosure text;
alter table files add column if not exists shortclosure_date date;

alter table supply_orders add column if not exists shortclosure text;
alter table supply_orders add column if not exists shortclosure_date date;
