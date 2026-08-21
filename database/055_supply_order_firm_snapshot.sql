alter table supply_orders
  add column if not exists firm_unique_no text,
  add column if not exists firm_contact_no text,
  add column if not exists firm_city text;
