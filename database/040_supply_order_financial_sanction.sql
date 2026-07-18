alter table supply_orders
  add column if not exists financial_sanction_date date;
