alter table app_settings
  add column if not exists firm_rating_config jsonb not null default
    '{"fields":[{"id":"delivery","label":"Delivery","weight":"1"},{"id":"quality","label":"Quality","weight":"1"},{"id":"afterSalesService","label":"After Sales Service","weight":"1"}]}'::jsonb;

alter table supply_orders
  add column if not exists firm_rating_values jsonb not null default '{}'::jsonb;
