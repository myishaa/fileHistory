alter table supply_orders
  add column if not exists psb_applicable text,
  add column if not exists bg_coverage_type text,
  add column if not exists psb_bg_no text,
  add column if not exists psb_bg_amount numeric,
  add column if not exists psb_bg_received_date date,
  add column if not exists psb_bg_validity_date date,
  add column if not exists psb_bg_return_date date,
  add column if not exists pwb_bg_no text,
  add column if not exists pwb_bg_amount numeric,
  add column if not exists pwb_bg_received_date date,
  add column if not exists pwb_bg_validity_date date,
  add column if not exists pwb_bg_return_date date,
  add column if not exists combined_bg_no text,
  add column if not exists combined_bg_amount numeric,
  add column if not exists combined_bg_received_date date,
  add column if not exists combined_bg_validity_date date,
  add column if not exists combined_bg_return_date date;

alter table files
  drop column if exists bg_validity_date,
  drop column if exists bg_return_date;

alter table supply_orders
  drop column if exists bg_validity_date,
  drop column if exists bg_return_date;

create index if not exists supply_orders_psb_bg_pending_idx
on supply_orders(file_id, psb_applicable, psb_bg_received_date, psb_bg_return_date);

create index if not exists supply_orders_pwb_bg_pending_idx
on supply_orders(file_id, bg_coverage_type, pwb_bg_received_date, pwb_bg_return_date);

create index if not exists supply_orders_combined_bg_pending_idx
on supply_orders(file_id, bg_coverage_type, combined_bg_received_date, combined_bg_return_date);
