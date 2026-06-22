alter table files
add column if not exists bill_preparation_date date;

alter table supply_orders
add column if not exists bill_preparation_date date;
