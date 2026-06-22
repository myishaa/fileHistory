alter table files
add column if not exists ir_preparation_date date,
add column if not exists ir_receipt_date date;

alter table supply_orders
add column if not exists ir_preparation_date date,
add column if not exists ir_receipt_date date;
